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

## Non-goals for MK.42 (documented, not ignored)

- True two-person control (only one principal exists; "dual control" = two
  deliberate operator acts). Real multi-party approval lands with multi-user
  (`ROADMAP.md` MK.90+).
- Hardware security modules / TPM-backed key storage — keys are in OS keychain /
  secrets file for MK.42; HSM is a later hardening step.
- Network-level microsegmentation beyond the LAN + mTLS — sufficient for two
  nodes; revisit when nodes go off-LAN (`apps/relay`).
