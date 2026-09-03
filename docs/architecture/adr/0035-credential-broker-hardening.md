# ADR-0035: The Credential Broker fails closed on missing material, mints only against a live authority token, hands secrets to workers only out-of-process; real secret storage is built

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ADR-0025 §2, ADR-0027 (authority token), SECURITY_MODEL §5, DATA_OWNERSHIP §Secrets; corrects the as-built `broker.ts`

## Context

`AUDIT_MK42_ASCENSION.md` F-AG-8, F-SEC-3:

- `broker.ts`: `const secret = await this.material.get(provider) ?? randomUUID();`
  — a missing credential silently becomes a random one and the mint "succeeds".
- `kind` (`derived` vs `wrapped-static`) is hard-coded to
  `provider === 'github' || provider === 'docker'`, not the manifest.
- `mint` takes an `invocationId` string and trusts it; there is no authority-
  token gate (ADR-0027 says the broker "mints only against a live, unexpired,
  unconsumed token for that `invocationId`").
- On the (current, wrong) in-process path, `wrapped-static` exposes
  `use: fn => fn(secret)` — the adapter gets the real string, and `ctx.log` is
  `() => undefined` so the redactor never runs.
- There is **no real secret storage**: `SECURITY_MODEL.md` §5 / `DATA_OWNERSHIP.md`
  say "OS keychain / `0600` secrets file, loaded only into the Broker process".
  No keychain integration, no file loader, no mode check exists.

Laws at stake: L30 (security architectural), L29 (Kernel protected — a
compromised in-process adapter with the real secret defeats partitioning),
L31 (audited).

## Decision

### 1. Fail closed on missing material

`broker.mint` throws `CredentialUnavailableError` when
`material.get(providerKey)` returns nothing. No fabrication, no `randomUUID()`
fallback. The Executor treats this as `FAILED` (nothing executed) and emits a
`SECURITY`-class `jarvis.security.alert.elevated` (`detector: cred.unavailable`).
A capability whose credential is not configured is simply not invocable.

### 2. Material source: secrets file now, keychain seam

- MK.42/47: a single `JARVIS_SECRETS_FILE` (JSON, `chmod 0600`, ownership
  checked at load; the loader **refuses** a file that is group/other-readable
  or not owned by the Kernel user). Loaded **once** at Kernel start into the
  Broker process memory; never written back; not in any other process's env.
- `CredentialMaterialStore` interface stays; `KeychainCredentialMaterialStore`
  (macOS Keychain / Windows Credential Manager / libsecret) is the documented
  next implementation, same interface. HSM/TPM remains an MK.42 non-goal.
- The Broker process runs with **no inbound network except the Executor
  channel** (mTLS on multi-node; a unix socket / in-process protected call on
  the single box). It has no DB handle, no NATS handle.

### 3. Mint requires a live authority token

`broker.mint(authorityToken, capabilityId, action, resourceRef, mode)`:

1. The Permission Engine mints an `AuthorityToken` (opaque 256-bit, single-use,
   `invocationId`+`grantId`+`grantVersion`+`principalId` bound, ≤120 s TTL,
   Redis + durable issuance event) **only** for an invocation Policy resolved
   to `ALLOW`/`APPROVED` and past the freshness barrier (ADR-0033 §2).
2. The Executor passes the token to the Broker. The Broker validates it against
   the Permission Engine (live, unexpired, unconsumed, matches this
   `invocationId`), marks it consumed, then mints.
3. `mode: 'dry-run'` ⇒ a read-only / sandbox credential (STS read-only role,
   fine-grained token with no write scopes, a proxy token the proxy rejects
   for mutating verbs). A faked `simulate` or a faked verify read has no real
   access.

### 4. `kind` comes from the manifest; wrapped-static never reaches adapter code as a string

- `Capability.credentialKind: 'derived' | 'wrapped-static'` per action (or a
  capability default). `derived` is mandatory where the backend supports it
  (GitHub fine-grained installation token, AWS STS, signed Docker-proxy token);
  the SDK lint warns if a provider with a known derived path declares
  `wrapped-static`.
- `derived`: the worker redeems the handle through `ctx.http` / the proxy; the
  secret string never enters worker memory.
- `wrapped-static`: the secret is injected into the **worker** process memory
  (out-of-process, ADR-0025 §3) for the invocation lifetime, behind a
  `SecretBox` that exposes only `use(fn)` and `zeroize()`, is never logged, and
  is zeroized on worker exit. The **Broker → worker** channel (not Broker →
  Kernel) carries it, over the Adapter Host's typed IPC. The Kernel process
  never holds a `wrapped-static` secret.

### 5. Redaction is on by default and wired

- `ctx.log` in every worker is filtered by a redactor seeded with the
  fingerprint(s) of the secret(s) in scope for that invocation. A hit ⇒
  `«redacted»` in the log line **and** a `jarvis.security.alert.elevated`
  (`detector: cred.leak-attempt`).
- The redactor also runs over adapter **error messages** and the
  `execute_result_debug` field before persistence.
- Redaction matches the raw secret and common encodings (base64, url-encode,
  hex) of it, not only the exact substring (fixes F-AG-8c).
- `agency.invocations` stores `input_hash` (canonical, ADR-0033 §4), never
  `input`. `agency.credential_grants` records the mint (scope + TTL + kind),
  never material (boundary-sweep test already asserts this on the migration).

### 6. TTL bounds

Handle TTL ≥ the action's lease TTL (`max(action.timeoutMs, minLeaseMs)`), not
a fixed 120 s (fixes C5). The authority token stays ≤120 s but is consumed at
mint, so the handle's longer life is not a replay surface.

## Alternatives considered

- **Keep the `randomUUID()` fallback but log a warning.** Rejected — a
  "working" mint with a garbage secret produces confusing downstream failures
  and, for signing, a silently invalid signature.
- **Broker hands the secret to the Kernel, Kernel forwards to the worker.**
  Rejected — the Kernel process then holds every adapter secret in memory,
  collapsing the partition ADR-0025 exists to create.
- **Env vars / mounted files per adapter (12-factor).** Rejected by ADR-0025
  already — a poisoned dependency exfiltrates a standing secret.

## Benefits

- A misconfigured credential fails loudly and safely.
- The Kernel process holds no adapter secret of any kind.
- A leaked authority token is worthless (consumed, wrong invocation, 2-min
  TTL); a leaked handle is scoped to one invocation's resource and mode.
- Secret leakage into logs/errors/traces is caught and alerted.

## Disadvantages

- The `SecretBox`-over-IPC for `wrapped-static` is real work (ADR-0025 §2 that
  was skipped). Until it exists, `wrapped-static` capabilities cannot run —
  which is correct (fail closed) but limits the initial adapter set to
  `derived` ones + `filesystem`/`terminal`/`windows` (which need no network
  secret).
- A secrets-file loader with ownership/mode checks is platform-specific
  (Windows ACL vs POSIX mode).

## Risks

- **The Broker is a single point of secret compromise.** Mitigated (ADR-0025
  risks): memory-only, no writes, `mint` is the only entry, no inbound network
  but the Executor/worker channel, every mint audited, fails closed.
- **`derived` path misconfigured (wrong proxy URL) silently downgrades
  security.** Mitigated: the proxy rejects unknown verbs/hosts; a `derived`
  mint that cannot reach its issuer fails closed per §1.

## Consequences

- `apps/core/src/kernel/credential-broker/`: `material-store.ts` gains
  `FileCredentialMaterialStore` with ownership/mode checks; `broker.ts` throws
  on missing material, takes an authority token, reads `credentialKind` from
  the manifest; `redact.ts` gains encoding-aware matching and is wired into the
  Adapter Host `ctx.log` and error path.
- `apps/adapter-host/`: carries the `SecretBox` over its IPC for
  `wrapped-static`; `ctx.http` for `derived` redeems the handle through the
  proxy.
- `contracts/src/capability.ts`: `credentialKind` field.
- `permission/`: `AuthorityToken` minting + consume-on-mint wired.
- `SECURITY_MODEL.md` §5, `DATA_OWNERSHIP.md` §Secrets updated; threat-model
  T22 moves to `enforced` with the redaction test.

## Reversal difficulty

**High.** The token-gated mint and the out-of-process secret handling are the
enforcement of L29/L30 credential partitioning.
