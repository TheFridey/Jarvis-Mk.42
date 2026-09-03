# Threat Model

Structured enumeration. Each threat lists the asset at risk and the
**structural** mitigation (not "be careful"). Cross-references
`SECURITY_MODEL.md`.

## Assets

| Asset | Where | Guardian |
|---|---|---|
| Authoritative state (events, projections) | PostgreSQL, local server | Kernel; per-schema DB roles |
| Beliefs (World Model) | PostgreSQL `world_model` | World Model service; ingestion-only writes |
| Experience (Memory) | PostgreSQL `memory` + pgvector | Memory service |
| Provider API keys | Model Gateway process | Credential partitioning |
| Resource credentials (GitHub token, Docker socket, FS root) | Individual adapter processes | Scoped per adapter |
| The principal's privacy (camera/mic, personal facts) | Workstation; local server | L27; locality enforcement; `principalId` scoping |
| The ability to act (capabilities) | Executor pipeline | Policy + Permission + verify + audit |

## Threats & mitigations

| # | Threat | Structural mitigation |
|---|---|---|
| T1 | Jailbroken / malicious model tries to act | Model holds no credentials, no capability handle, no state access. Output is a `Proposal` gated by the full Executor pipeline. Escalates to nothing. (ADR-0018) |
| T2 | Prompt injection via fetched web page / document | Content tagged `untrusted` at capture; any derived `Proposal` is `derivedFromUntrusted`; policy caps it at `riskClass: LOW` and forbids strong belief-writes. (`SECURITY_MODEL.md` §4.3) |
| T3 | Compromised capability adapter | Out-of-process; holds only its own scoped credential; every invocation still passes Policy/Permission; mandatory `verify` + audit detect anomalous effects; `resourceKey` lease bounds concurrency/blast radius. |
| T4 | Rogue or buggy agent | No credentials; Agent-Runtime-mediated; lease caps on cost/context/wall-time; output validated before any event is emitted; cannot spawn sub-agents or call the Executor. (L10) |
| T5 | Malicious guest node | `guest` trust tier: no observations accepted, presentation surface only, AMBIENT read-only. Cannot self-upgrade tier. (`node-protocol.md`) |
| T6 | Operator-unreachable abused to force auto-approval | REQUIRE_APPROVAL **fails closed** (queued, not executed) unless an explicit standing grant scope permits proceeding. No ALLOW fallback. (`FAILURE_MODEL.md` §4) |
| T7 | Replay of a stale command or authority token | `commandId` dedupe; authority tokens are short-TTL in Redis; grant **freshness barrier** re-reads grant version in the `capability.started` transaction. |
| T8 | Data exfiltration through cognition | Cognition cannot call capabilities or the network; the gateway is the only egress and logs metadata only; sending data out is an explicit HIGH/CRITICAL capability with approval + audit. |
| T9 | State corruption via concurrency | One projector per read model (single-writer); per-id serialisation for objectives; freshness barrier + revocable leases for long actions. (`STATE_MODEL.md` §5) |
| T10 | Unbounded growth / resource exhaustion (a DoS on ourselves) | Event classes + partition-drop of signal events; perception debounce/aggregate; bounded queues with defined overflow; fact archival; Memory decay. (review §16.11) |
| T11 | Malformed model output crashing a consumer | Validator rejects → `output_rejected` event → bounded retry → simpler model → ask principal. Unknown-higher `schemaVersion` events are quarantined, not fatal. |
| T12 | Node impersonation | mTLS client certs verified against the node registry; trust tier assigned by operator policy at admission, stored durably, not self-declared. |
| T13 | Privilege creep in grants over time | Grants are scoped and TTL'd; every issue/revoke is a ledger event; Audit Manager can report current effective authority for the principal at any time. |
| T14 | Sensitive context leaking to cloud models | Context Compiler classifies sensitivity; gateway forces `prefer-local` and forbids `cloud-ok` without a HIGH-risk approval; every `model.called` records locality. (`LOCALITY_MODEL.md` §3) |
| T15 | Supply-chain compromise of a dependency | Monorepo lockfile + pinned versions; adapters run out-of-process with minimal scoped credentials so a poisoned dependency in one adapter cannot reach the Kernel or other adapters' credentials. |

## Agency Plane threats (HEPHAESTUS — ADR-0025..0030)

Each mitigation is structural. Cross-references
`AGENCY_MODEL.md`, `SENTINEL_MODEL.md`, and the ADRs.

| # | Threat | Structural mitigation |
|---|---|---|
| T16 | **Tool-output / tool injection** — an adapter result or fetched API response carries hostile instructions a downstream model then "obeys" | Adapter results are typed data validated against the action `outputSchema`; free-text fields are tagged `untrusted` and carry `origin` provenance; the Kernel never interprets a result field as a command; a result can only become a new `Proposal` that re-enters the full Executor pipeline (ADR-0018, ADR-0025 §6). |
| T17 | **Malicious document** ingested (a crafted file/email/page shaped to trigger an action) | Ingestion tags every derived item `derivedFromUntrusted`; the Policy Engine hard cap denies any `riskClass > LOW` for an untrusted-derived invocation (ADR-0026 evaluation order §1); it cannot be written as a belief stronger than `epistemicStatus: retrieved`. |
| T18 | **Poisoned retrieval** — a planted memory/RAG entry steers a later decision | Retrieved context carries source trust + provenance; the Context Compiler marks it; an untrusted-derived proposal is capped identically to T17; the retrieval store is not an authority and cannot set a policy verdict. |
| T19 | **Capability privilege escalation** — an invocation asks for scope beyond its grant | Scope is fixed at grant-issue time; `action.requiredScopes ⊄ actor.heldScopes` is an engine hard cap ⇒ **DENY** (never "ask"); the authority token is minted with exactly the grant's scopes and re-checked at the freshness barrier (ADR-0026, ADR-0027). No "scope upgrade" code path exists. |
| T20 | **Confused deputy** — an agent gets the Executor to act with authority the requester lacks | The authority token binds `principalId` + `invocationId`; the Policy Engine evaluates the **originating** actor's `heldScopes`, not the Executor's; the Executor holds **no ambient authority** and cannot mint for itself (ADR-0025 §1, ADR-0027). |
| T21 | **Event spoofing / forged ledger event** — a fake `capability.verified` advances a plan | Only Kernel components hold the NATS ledger-publish credential; adapters/agents/gateway cannot append; the Event Manager validates envelope + `source`; `jarvis.agency.invocation.*` events are accepted only from the Executor's `source` id; the Orchestrator advances only on an event it did not emit (MIND §13.2). |
| T22 | **Credential leakage** via logs, model context, error messages, or traces | The Credential Broker is the sole holder of material; `ctx.credential` is a handle, not a string, for `derived` mints; SDK lint bans `process.env` secret reads and bare `fetch`; the worker→Executor channel runs a redactor seeded with the secret fingerprint (a hit ⇒ `«redacted»` + `security.alert.elevated`); `agency.invocations` stores `input_hash`, never `input`; secrets never enter an event payload (ADR-0025 §2, ADR-0030). |
| T23 | **Malicious / compromised extension** — a FORGE-authored adapter is subtly hostile | Built and tested only inside JARVIS LABS with synthetic credentials and no route to real infra; deterministic static + security-lint + dependency-audit + declared-egress gate; **mandatory human review** (concrete diff + reports, not a summary); registration only by the Capability Registry, never automated; the new capability enters **probation** (`max(declared, HIGH)` + `approvalPolicy: always`) until a second operator trust Command, and Sentinel flags every probationary invocation (ADR-0029). |
| T24 | **Command injection** into the `terminal` / shell adapter | No shell: the adapter takes an **argv array only** — no `sh -c`, no string interpolation, no glob expansion; `argv[0]` must match the grant's `command-allow` list; `riskClass: HIGH` minimum ⇒ approval or an explicit pre-authorised command scope; simulate-first describes the exact argv (ADR-0026 base pack, §8). |
| T25 | **Cross-user resource access** — principal A's grant used against principal B's resource | Every grant, invocation, lease, and resource row is `principalId`-scoped; the Policy Engine denies when `actor.onBehalfOf != resource.principalId`; the broker mints only the requesting principal's scoped credential; the authority token carries `principalId` and is rejected for a mismatched resource (ADR-0027, L34). |
| T26 | **Unsafe / failed rollback** — an "undo" that half-works or silently no-ops | `rollback` produces a real effect and is **itself verified** by the Executor (`RollbackReport.undone`); residual items ⇒ CRITICAL alert + GUARDIAN recommendation; rollback eligibility is bounded by the action's retention window; "assumed undone" is not a code path (ADR-0025 §6 step 11, AGENCY_MODEL §7). |
| T27 | **Fake verification** — a compromised adapter reports success it did not achieve | `verify` is **Executor-run** via the manifest `verificationStrategy` against the world under a read-only credential; the adapter's `execute` return value (and any HTTP 200) is a debug field only and never flips the state to `COMPLETED`; a `dry-run` credential means a faked `simulate` has no real access (L22, ADR-0025 §6, ADR-0016 risks). |
| T28 | **Action race / double-execution / TOCTOU on a grant** | `resourceKey` mutual-exclusion lease (`FOR UPDATE`); per-invocation `idempotencyKey`; the freshness-barrier grant re-read is in the **same transaction** as the `EXECUTING` row write and the `capability.started` append; `agency.invocations` is single-writer (the Executor); a duplicate proposal for the same `idempotencyKey` is deduped (ADR-0027 §freshness, STATE_MODEL §5). |

## Non-goals for MK.42 (documented, not ignored)

- True two-person control (only one principal exists; "dual control" = two
  deliberate operator acts). Real multi-party approval lands with multi-user
  (`ROADMAP.md` MK.90+).
- Hardware security modules / TPM-backed key storage — keys are in OS keychain /
  secrets file for MK.42; HSM is a later hardening step.
- Network-level microsegmentation beyond the LAN + mTLS — sufficient for two
  nodes; revisit when nodes go off-LAN (`apps/relay`).
