# ADR-0037: Node Protocol v1 is implemented (identity, enrollment, rotation, revocation, attestation, trust-tier store); backup and restore are built and drilled

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: docs/protocols/node-protocol.md, SECURITY_MODEL §6, STATE_MODEL §8, ROADMAP MK.51+; L35, L37, L38, L39

## Context

`docs/protocols/node-protocol.md` and `SECURITY_MODEL.md` §6 define a node
lifecycle (CONNECT → AUTHENTICATE → DECLARE → ADMIT → HEARTBEAT → OPERATE →
DISCONNECT), four trust tiers, mTLS admission, "cannot self-upgrade", per-tier
observation acceptance and capability ceilings. **None of it is implemented**:
no `packages/protocol`, no `NodeDescriptor` handler, no node registry writer,
no admission flow, no heartbeat, no `node.isolate`. Every event's `source.node`
is the single `config.nodeId` constant. See `AUDIT_MK42_ASCENSION.md` F-SEC-2,
F-DIST-1, F-DIST-2.

Separately, `STATE_MODEL.md` §8 describes a backup strategy (WAL archiving,
nightly base backup, object-storage sync, "recovery = restore + cold start")
with **no script, no runbook, no drill** (F-DATA-1). The ASCENSION prompt:
"JARVIS's accumulated knowledge cannot disappear because a disk fails ... Test
restoration."

These are grouped because both are prerequisites for MK.42 being a real
foundation rather than a single-process demo, and both are pure additions (no
law change).

## Decision

### Part A — Node Protocol v1

#### A1. `packages/protocol` — the wire contract

`NodeDescriptor` (already sketched in `contracts/src/node.ts`) becomes the
DECLARE payload: `nodeId`, `nodeType`, `protocolVersion`, `deviceIdentity`
(cert fingerprint), `owner` (principalId), `sensors[]` (observation types),
`outputs[]`, `compute` (cpu/gpu/mem hints), `capabilities[]` (manifest ids it
can host), `surfaces[]`, `networkState`, `softwareVersion`, `health`,
`requestedTrustTier`. Message framing, version negotiation, and the
CONNECT/AUTH/DECLARE/ADMIT/HEARTBEAT/OPERATE/DISCONNECT state machine are typed
here. Adding a sensor or capability type does **not** bump `protocolVersion`;
only framing/lifecycle changes do.

#### A2. Node identity lifecycle

- **Enrollment.** An operator issues a node enrollment token (short TTL,
  single-use, bound to a `requestedTrustTier` ceiling). The node generates a
  keypair, presents a CSR + the token; the Kernel signs a client cert bound to
  `nodeId`, records the fingerprint in `projections.nodes`. No token ⇒ no
  admission (guest tier can be opened per-session by the operator without
  enrollment, presentation-surface only).
- **Authentication.** mTLS; the presented cert fingerprint must match the
  registry row. Transport: mTLS WebSocket or per-node-credentialled NATS,
  terminated at the Kernel (MK.42) or `apps/relay` (off-LAN, future).
- **Rotation.** A node may request re-issuance before expiry over its
  authenticated channel; the Kernel issues a new cert, keeps the old
  fingerprint valid for a short overlap, then retires it. Certs carry an
  expiry (default 90 d); Sentinel `integrity.cert-expiry` fires within D days.
- **Revocation.** An operator `node.revoke(nodeId)` command: registry row
  marked revoked, cert fingerprint denylisted, live subscriptions dropped,
  hosted capability adapters marked unavailable, presence updated. This is also
  Guardian step G5 (`node.isolate`), which now has a real implementation.
- **Attestation (where practical).** The DECLARE `health` block may carry a
  platform attestation (TPM quote / OS integrity hash) for `owned-secure`+
  nodes; MK.42 records it and lets policy branch on its absence
  (restrict-only), it does not yet require a hardware root of trust (HSM/TPM
  remains an MK.42 non-goal — attestation is best-effort evidence).

#### A3. Trust-tier store and enforcement

- `projections.nodes` (already owned by the Presence Manager per
  `DATA_OWNERSHIP.md`) holds `trustTier`, set at admission by operator policy,
  **never self-declared, never self-upgraded** (a fitness test asserts no code
  path writes `trustTier` from a `NodeDescriptor` field).
- Enforcement points: the Event Manager rejects an observation whose `type` is
  not in the source node's declared `sensors[]` or whose class exceeds the
  tier's ceiling (`owned-mobile` ⇒ presence/location/voice-intent only;
  `guest` ⇒ none unless per-session opt-in). The Executor refuses to host a
  capability invocation on a node below the manifest's `trustTierMin`, and
  requires Kernel-side dual control for CRITICAL regardless of host tier.
- `RESTRICTED` `privacyClass` events do not propagate to a node below
  `owned-secure` without a HIGH-risk capability (the field exists; this ADR
  gives it an enforcement site).

#### A4. Heartbeat, liveness, loss

Negotiated-interval heartbeats; Presence Manager tracks liveness in Redis;
missed beats ⇒ `jarvis.infra.node.heartbeat_missed` ⇒ `node.unavailable` ⇒
subscriptions dropped, hosted adapters unavailable, in-flight invocations there
time out to `VERIFICATION_FAILED` (`FAILURE_MODEL.md` §Node disappears — now
real). Reconnect re-runs DECLARE; `guest`/`owned-mobile` re-confirm tier.

#### A5. Session continuity across nodes (design + minimal impl)

A `Session` gains an `activeEndpointNodeId`. When presence shifts (the operator
leaves the workstation, the phone becomes present), the Session Manager emits
`session.endpoint_changed`; Notification routing and voice output follow the
active endpoint. **JARVIS identity and authoritative state do not fork** — the
session is one row, the endpoint is an attribute. MK.42 implements the endpoint
switch for the workstation↔(one) mobile node case; the general case is MK.51+.

### Part B — Backup and restore

#### B1. What is backed up

Everything authoritative + recoverable-knowledge: PostgreSQL (all schemas —
`events`, `projections`, `atlas`, `mnemosyne`, `agency`, `identity`,
`session`, `audit`, `policy`), object storage (blobs, episode bodies,
evidence artifacts), and the config set (policy rules export, capability
manifests, grants, objectives, procedures — these are in PG, so PG covers
them). **Not** backed up: Redis (ephemeral, reconstructible), the secrets file
(backed up out-of-band by the operator, never into the same store).

#### B2. Mechanism

- **PostgreSQL**: continuous WAL archiving to object storage + a nightly
  `pg_basebackup`. A committed `scripts/backup-pg.mjs` and a compose service
  for the WAL archiver. Point-in-time recovery target: any second in the
  retention window (default 30 d).
- **Object storage**: versioned bucket + periodic sync to a second location.
- **Backup health** is a Sentinel detector (`integrity.backup-stale`, already
  defined) fed by a `jarvis.infra.backup.completed` event the backup script
  emits.

#### B3. Restore runbook + drill

- A committed `docs/runbooks/restore.md`: restore PG (base + WAL to target),
  restore object storage, start the Kernel → cold start rebuilds Projected
  State from `events`, discards Ephemeral, compensates orphaned invocations
  (ADR-0033 §5).
- An automated **restore drill** (`scripts/restore-drill.mjs`, gated like the
  integration tests): take a backup of a seeded stack, wipe the volume, restore,
  boot, assert event count / projection hashes / a known objective / a known
  fact all match. Run in CI on a schedule. A restore that does not reproduce
  the pre-wipe state is a release blocker.

#### B4. Retention enforcement

The retention classes (`STATE_MODEL.md` §2.1) get a single owner —
`RetentionSweeper` (exists) — extended to enforce **all** classes and a
`docs/architecture/RETENTION.md` policy object: raw audio/video (never
persisted; bounded local ring only), screenshots/visual evidence (object
storage, class TTL, `RESTRICTED`), observations (signal window), traces
(14 d, in the OTel backend not PG), model outputs (not persisted by default),
memories (MNEMOSYNE decay/forget when built), audit (indefinite, cold-storage
partitions). A CI check asserts every `jarvis.perception.*` event type is
declared `TRANSIENT`.

## Alternatives considered

- **Defer the Node Protocol to MK.51 as the ROADMAP says.** Rejected for
  ASCENSION — the phase's stated subject is distribution and node security, and
  L38 (robotics) / L27 (raw frames stay local) have **no enforcement site**
  without it. Even the single workstation should be a real enrolled node.
- **`pg_dump` nightly instead of WAL archiving.** Rejected — loses up to a day;
  knowledge accrual is continuous.
- **Back up Redis too, for faster warm restart.** Rejected — it holds nothing
  authoritative; a cold rebuild is correct and simple.

## Benefits

- L27/L35/L37/L38 gain real enforcement sites.
- A disk failure is a restore, not a loss of everything JARVIS has learned.
- The single-box deployment is exercised as a two-node system from day one, so
  the multi-node future is de-risked.

## Disadvantages

- `apps/adapter-host` and the workstation processes must speak the protocol and
  hold a node cert — more moving parts on the dev box.
- WAL archiving + a restore drill add infra and CI time.

## Risks

- **Cert/key management on the dev box is fiddly and gets bypassed ("just use
  a shared secret").** Mitigated: `packages/testkit` ships a local CA helper;
  the Kernel refuses a non-mTLS node connection outside an explicit
  `JARVIS_DEV_INSECURE=1` that also forces every node to `guest` tier.
- **The restore drill is flaky and gets disabled.** Mitigated: it asserts
  content hashes, not timings; it is the one test whose failure blocks a
  release by policy.

## Consequences

- New `packages/protocol`; `contracts/src/node.ts` extended.
- `apps/core`: node admission handler, `projections.nodes` writer path,
  heartbeat tracker, observation-type/tier enforcement in the Event Manager,
  `node.revoke`/`node.isolate` command.
- `apps/adapter-host`, workstation processes: node client + cert.
- New `scripts/backup-pg.mjs`, `scripts/restore-drill.mjs`,
  `docs/runbooks/restore.md`, `docs/architecture/RETENTION.md`; compose gains a
  WAL archiver.
- `Session` gains `activeEndpointNodeId`; `session.endpoint_changed` event.
- `node-protocol.md` promoted from "v1 draft" to "v1"; `SECURITY_MODEL.md` §6
  and `STATE_MODEL.md` §8 move to `Enforcement: enforced` / built.

## Reversal difficulty

**Moderate** for the protocol (contracts version additively; the state machine
is load-bearing once a second node exists). **Low** for backup (swap the
mechanism behind the runbook). **High** to remove node identity once multiple
nodes are enrolled.
