/**
 * Identity Manager (KERNEL_CONSTITUTION.md #1). Establishes WHO a principal,
 * device, node, or service is, and the AuthContext everything downstream reads.
 *
 * MK.43 auth methods: `bootstrap` (local operator scrypt credential), `token`
 * (opaque bearer registered against an identity), `mtls` (node cert CN match).
 * `voice` / `biometric` are FUTURE INTERFACES - calling them returns
 * `method_unsupported`, never a fake success (engineering rule).
 *
 * Multi-user from the schema down: nothing here assumes a single principal.
 */
import {
  EventNames,
  type AuthContext,
  type AuthenticateRequest,
  type AuthenticateResult,
  type Identity,
  type IdentityKind,
  type Principal,
  type TrustLevel,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import { hashSecret, verifySecret } from './hashing.ts';
import { IdentityStore } from './identity-store.ts';

export interface BootstrapConfig {
  principalId: string;
  displayName: string;
  credential: string;
  nodeId: string;
}

export class IdentityManager {
  constructor(
    private readonly deps: {
      store: IdentityStore;
      events: EventManager;
      clock: Clock;
      ids: IdGen;
      credentials?: { revokeIdentity(identityId: string, at: string): Promise<void> };
    },
  ) {}

  /** Idempotently ensure the bootstrap operator principal + credential exist. */
  async ensureBootstrap(cfg: BootstrapConfig): Promise<{ principal: Principal; identity: Identity }> {
    const now = this.deps.clock.nowIso();
    const principal: Principal = {
      id: cfg.principalId,
      displayName: cfg.displayName,
      isOperator: true,
      createdAt: now,
    };
    await this.deps.store.upsertPrincipal(principal);

    let identity = await this.deps.store.findIdentity('principal', cfg.principalId);
    if (!identity) {
      identity = {
        id: this.deps.ids.ulid(),
        kind: 'principal',
        principalId: cfg.principalId,
        externalRef: cfg.principalId,
        displayName: cfg.displayName,
        trust: 'verified',
        createdAt: now,
      };
      await this.deps.store.upsertIdentity(identity);
    }
    if (!(await this.deps.store.getCredential(identity.id, 'bootstrap'))) {
      await this.deps.store.setCredential(identity.id, 'bootstrap', await hashSecret(cfg.credential));
    }
    return { principal, identity };
  }

  async registerIdentity(args: {
    kind: IdentityKind;
    principalId: string;
    externalRef: string;
    displayName: string;
    trust: TrustLevel;
    tokenSecret?: string;
  }): Promise<Identity> {
    const existing = await this.deps.store.findIdentity(args.kind, args.externalRef);
    if (existing) return existing;
    const identity: Identity = {
      id: this.deps.ids.ulid(),
      kind: args.kind,
      principalId: args.principalId,
      externalRef: args.externalRef,
      displayName: args.displayName,
      trust: args.trust,
      createdAt: this.deps.clock.nowIso(),
    };
    await this.deps.store.upsertIdentity(identity);
    if (args.tokenSecret) {
      await this.deps.store.setCredential(identity.id, 'token', await hashSecret(args.tokenSecret));
    }
    return identity;
  }

  async authenticate(req: AuthenticateRequest): Promise<AuthenticateResult> {
    const correlationId = this.deps.ids.ulid();

    if (req.method === 'voice' || req.method === 'biometric') {
      await this.emitFailure(req, 'method_unsupported', correlationId);
      return {
        ok: false,
        code: 'method_unsupported',
        detail: `${req.method} identity is a future interface, not implemented in MK.43`,
      };
    }

    let identity: Identity | null = null;
    if (req.method === 'bootstrap') {
      identity = req.claimedPrincipalId
        ? await this.deps.store.findIdentity('principal', req.claimedPrincipalId)
        : null;
    } else if (req.method === 'token') {
      identity = req.claimedPrincipalId
        ? await this.deps.store.getIdentity(req.claimedPrincipalId)
        : null;
    } else if (req.method === 'mtls') {
      identity = await this.deps.store.findIdentity('node', req.credential /* CN */);
    }

    if (!identity) {
      await this.emitFailure(req, 'unknown_identity', correlationId);
      return { ok: false, code: 'unknown_identity', detail: 'no matching identity' };
    }
    if (identity.revokedAt) {
      await this.emitFailure(req, 'revoked', correlationId);
      return { ok: false, code: 'revoked', detail: 'identity revoked' };
    }
    const principal = await this.deps.store.getPrincipal(identity.principalId);
    if (!principal || principal.disabledAt) {
      await this.emitFailure(req, 'disabled_principal', correlationId);
      return { ok: false, code: 'disabled_principal', detail: 'principal disabled' };
    }

    if (req.method === 'bootstrap' || req.method === 'token') {
      const stored = await this.deps.store.getCredential(identity.id, req.method);
      if (!stored || !(await verifySecret(req.credential, stored))) {
        await this.emitFailure(req, 'bad_credential', correlationId);
        return { ok: false, code: 'bad_credential', detail: 'credential mismatch' };
      }
    }
    // mtls: presence of a registered node identity for the CN is the proof in MK.43.

    const trust: TrustLevel =
      req.method === 'bootstrap' ? 'verified' : req.method === 'mtls' ? 'trusted' : identity.trust;

    const context: AuthContext = {
      identityId: identity.id,
      principalId: identity.principalId,
      kind: identity.kind,
      method: req.method,
      trust,
      nodeId: req.nodeId,
      authenticatedAt: this.deps.clock.nowIso(),
    };

    await this.deps.events.emit({
      type: EventNames.IdentityAuthenticated,
      retentionClass: 'SECURITY',
      privacyClass: 'INTERNAL',
      subject: { kind: 'identity', id: identity.id },
      actor: { kind: identity.kind === 'principal' ? 'principal' : 'node', id: identity.id },
      correlationId,
      causationId: correlationId,
      principalId: identity.principalId,
      payload: {
        identityId: identity.id,
        principalId: identity.principalId,
        kind: identity.kind,
        method: req.method,
        trust,
        nodeId: req.nodeId,
      },
    });

    return { ok: true, context };
  }

  async revokeIdentity(identityId: string): Promise<void> {
    const at=this.deps.clock.nowIso();await this.deps.store.revoke(identityId, at);await this.deps.credentials?.revokeIdentity(identityId,at);
    const identity = await this.deps.store.getIdentity(identityId);
    await this.deps.events.emit({
      type: EventNames.IdentityRevoked,
      retentionClass: 'SECURITY',
      privacyClass: 'INTERNAL',
      subject: { kind: 'identity', id: identityId },
      actor: { kind: 'system', id: 'identity-manager' },
      correlationId: this.deps.ids.ulid(),
      causationId: 'none',
      principalId: identity?.principalId ?? 'system',
      payload: { identityId, reason: 'revoked by operator' },
    });
  }

  private async emitFailure(
    req: AuthenticateRequest,
    code: string,
    correlationId: string,
  ): Promise<void> {
    await this.deps.events
      .emit({
        type: EventNames.IdentityAuthFailed,
        retentionClass: 'SECURITY',
        privacyClass: 'INTERNAL',
        subject: { kind: 'identity', id: req.claimedPrincipalId ?? 'unknown' },
        actor: { kind: 'system', id: 'identity-manager' },
        correlationId,
        causationId: correlationId,
        principalId: req.claimedPrincipalId ?? 'unknown',
        payload: {
          method: req.method,
          code,
          nodeId: req.nodeId,
          ...(req.claimedPrincipalId ? { claimedPrincipalId: req.claimedPrincipalId } : {}),
        },
      })
      .catch(() => undefined);
  }
}
