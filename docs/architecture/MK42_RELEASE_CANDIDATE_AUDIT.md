# MK.42 Release Candidate Audit

> **Point-in-time RC1 evidence.** The observability and insecure-default items
> recorded here were addressed in RC1.2. See `ROADMAP.md`, ADR-0036, and the
> current source/tests for present-tense status; the findings below are retained
> unchanged as historical audit evidence.

**Auditor:** External Principal Architect + Release Auditor (Claude Opus 5), engaged as a hostile reviewer who did not build this system.
**Date:** 2026-09-08
**Audited commit (entry):** `010114f` — `test: validate mk42 realtime hardware integration`
**Method:** code and runtime only. No commit message, README claim, ADR status label, prior model summary, or reassuring test name was accepted as evidence. Every claim below is traceable to a file, a command, or a captured result. Where a capability could not be exercised in this environment it is listed as **unverified**, never as passing.

---

## FINAL VERDICT

# MK.42 RC1 — GO

The constitutional invariants hold under adversarial tracing. Authority cannot be reached by a model, an agent, a perception surface, or the desktop. The single Executor pipeline has no bypass. Policy, permission, approval and credential minting all fail closed. Disaster recovery is a genuine `pg_dump` → destroy → `pg_restore` → boot drill that proves ATLAS, MNEMOSYNE, objectives and agency state survive and that a completed invocation is not re-executed. Sensitive knowledge cannot reach a cloud model: two independent layers refuse it and the system fails closed when no local route exists.

Thirteen defects were found during this audit. All thirteen were repaired within this pass and are listed under **Fixes made during audit**. Four of them were the kind that would have justified NO-GO if left standing — a mandatory gate that reported green while skipping every test, a node-liveness method that returned an empty array behind an ADR claiming liveness was implemented, an ingestion mediator that fabricated provenance it was documented to reject, and a documented privacy-deletion path with no caller. None remain.

What remains is honestly-stated technical debt, and the documents now say so. The single largest correction this audit made was not to code but to claims: an ADR asserted node enrollment/liveness shipped when the protocol has no network ingress, a chaos suite claimed to fault-inject NATS/Redis/Postgres/Model-Gateway/Adapter-Host while the system under test was never in the loop, and a hardware validator reported `PASS` for a microphone it had just failed to find. Those are corrected. **RC1 describes what the code actually does.**

This verdict is explicitly **not** an assertion that voice, vision, or the composed "Jarvis — what's that?" interaction work. Those require interactive hardware validation that could not be performed here and are recorded as unverified.

---

## SCORES

| Area | Score | Basis |
|---|---|---|
| Architecture | 9 / 10 | Frozen-16 boundaries hold under tracing; knowledge plane genuinely separate from Kernel state; one Executor pipeline. Deductions: NestJS deviation persists, `packages/*` are pointer seams rather than build units. |
| Security | 8 / 10 | Session-bound credentials with full revocation cascade; replay-safe approvals with real dual control; HMAC-bound adapter IPC; fail-closed policy; credentials cannot be fabricated. Deductions: single-factor root of trust, `dev-bootstrap-secret` default with no non-loopback bind guard, unauthenticated loopback `/state`, verification reads through the audited adapter. |
| Reliability | 8 / 10 | Durable invocation lifecycle, lease takeover only after expiry, restart without re-execution, transactional outbox, consumer dedupe, deterministic degradation. Deduction: no fault injection against a live Kernel. |
| Cognition | 8 / 10 | Provider-neutral gateway, off-manifest output schema-rejected before it can act, agent proposal scope enforced, privacy-aware locality routing. Deductions: no live provider exercised; the runtime emits `ContextPackage` while `COGNITION_MODEL` still specifies `ContextFrame`. |
| World Model (ATLAS) | 8 / 10 | Real temporal facts with mandatory provenance (now enforced), epistemic-status ceiling, contradiction preserved not overwritten, belief history, observation→fact promotion. Deductions: privacy class is caller-asserted; causal layer is foundations-only by design. |
| Memory (MNEMOSYNE) | 8 / 10 | Five durable classes, candidate gate with persisted score breakdown, seven-factor recall with bounded similarity, deterministic consolidation, privacy deletion now wired and proven. Deductions: deterministic (non-model) embeddings; DREAMING has no agent stage. |
| Voice | 5 / 10 | Session/barge-in/device-loss logic real and integration-tested; **no hardware capability proven**. |
| Vision | 5 / 10 | Signal-only gesture path, local-by-default frames, policy-gated cloud path, all unit-tested; **no hardware capability proven**. |
| Spatial Interaction | 4 / 10 | Air Touch contracts and gating are real and low-confidence gestures are rejected; the desktop client's authentication was broken until this audit and no composed interaction was demonstrated. |
| Observability | 6 / 10 | Real `NodeSDK`, real exported spans, real ledger↔trace correlation proven against Postgres. Deductions: only two explicit spans; registered `instrumentation-pg` is structurally inert; undici untraced. |
| Disaster Recovery | 9 / 10 | Genuine dump artifact, database destruction, restore, Kernel boot, invariant assertions, no re-execution, hard-fails without Docker. Deduction: restore targets the same container rather than a separate host. |
| Testing | 8 / 10 | 200+ unit tests, 11 integration files against real ephemeral Postgres with zero skips, gates now hard-fail without Docker, 17 new adversarial probes added. Deductions: chaos scope, hardware NOT TESTED. |
| Documentation Accuracy | 7 / 10 | Weakest area on entry — two ADR/README claims were false and one ADR contradicted itself. All corrected in this pass; ADRs now carry honest `PARTIAL` statuses that match the code. |

---

## VERIFIED FUNCTIONALITY

Only items proven by a command whose output I read.

**Constitutional invariants**
- **Provider independence.** No provider SDK or wire shape exists outside `apps/gateway` — enforced by two fitness rules over all of `apps` and `packages`, not by convention.
- **Models cannot become authority.** `AgentRuntime` validates every proposal against a Zod discriminated union and the agent manifest's `proposalScope`; an off-scope kind is rejected before it can become an action (probe: `AUDIT C`).
- **Agents cannot act.** Proposals reach the world only through `AgencyIngress` → `CapabilityExecutor`. Agents touch the knowledge plane only via `KnowledgeAgentFacade`, which downgrades epistemic status, caps confidence at 0.85, forces `derivedFromUntrusted`, caps the causal ladder, and holds no store reference.
- **Perception cannot act.** Voice/vision gateways emit events only; raw frames are rejected outright; malformed confidence is rejected.
- **Desktop cannot act.** Every mutating desktop route requires a scoped session credential and returns `409` on a stale `expectedStateVersion`.
- **Single Executor pipeline.** Verification is Executor-owned: `VerificationRunner` interprets the strategy and performs the comparison; the fitness gate asserts `executor.ts` never calls `adapter.verify`, and completion is gated on `if (report.verified)`.
- **Policy fails closed.** `ModelRegistry.candidates` returning empty raises `NO_ROUTE`; `AdapterHost` rejects unbound, stale or spoofed worker replies; approval with no matching confirmation phrase for `CRITICAL` returns `false`.
- **Approvals are exact, durable and replay-safe.** Bound to invocation + operator + `nonce` + `version`; the decisive `UPDATE` is conditional on `state='pending' AND version=<expected> AND expires_at > now`, so a replay finds a bumped version and affects zero rows.
- **Dual control is real.** `CRITICAL` requires `authTrustLevel === 'verified'` **and** a confirmation phrase whose hash matches the manifest's, per `SECURITY_MODEL` §7. A `CRITICAL` capability with no configured phrase can never be approved — fail closed.
- **Credentials cannot be fabricated.** The broker mints only against an authority token, per invocation, with `dry-run` mode for verification reads, and revokes on exit.
- **Restart avoids duplicate execution.** Proven twice: the durable-agency integration suite ("classifies an expired in-flight effect without re-executing it") and the DR drill's post-restore Kernel boot.
- **Replay causes no side effects.** Replay runs on a separate `ReplayBus`, every replayed event is tagged `meta.replay='true'`, and a fitness rule forbids the event-fabric from importing the Executor, Adapter Host or capabilities.
- **Redis is not authority.** "A Redis outage does not touch authoritative state (PostgreSQL is authority)" passes against a real container.
- **Nodes cannot self-escalate.** `createEnrollment` refuses to mint a `kernel-local` ceiling; `enroll` clamps the requested tier to the token's ceiling (unit-proven: a node requesting `kernel-local` under an `owned-secure` token receives `owned-secure`).

**ATLAS**
- Entity persistence, alias resolution (id → canonical name → alias → embedding threshold), relationship validity windows, facts with provenance/confidence/epistemic status/temporal validity, the evidence graph, and observation rows that expire unless promoted.
- **Contradiction preserved:** two equally-authoritative conflicting facts both remain `active`, an `atlas.conflicts` row opens, and the conflict surfaces in compiled context as a `world_conflict` item. A principal assertion then resolves it `resolved_by_principal`.
- **Supersession + history:** a stronger belief archives the weaker one into `facts_archive`, `history()` returns the ordered chain with `supersededByFactId`, and `believedAt(t)` correctly reports the *former* belief. All survive a Kernel restart against the same database.
- **Observation → fact promotion** requires corroboration and a mean-confidence floor, and produces a *proposal* routed through the mediator; three corroborating observations promote, one does not, and disagreeing observations do not.
- **Inference cannot masquerade as observation** — newly enforced and probed: a `model`-origin producer claiming `epistemicStatus: 'observed'` is stored as `inferred`; claiming `asserted` without being a principal Command is stored as `inferred`; a `sensor`-origin promotion legitimately keeps `observed`.
- **Invalid provenance and out-of-range confidence are rejected** with no row written.

**MNEMOSYNE**
- Episodic, semantic, procedural and preference classes persist; working/session/spatial remain borrowed from their real owners and are not re-stored.
- The full pipeline is proven end to end: experience → candidate → scored disposition (breakdown persisted, answering "why do you remember that?") → episode → seven-factor recall → Context Compiler item → the compiled package actually handed to cognition.
- Recall is `top-k` + relevance floor with the similarity weight hard-capped; `weightsUsed` is returned on every call.
- **Privacy deletion works** — newly wired and probed: `forgetMemory` removes the episode, it disappears from recall *and* from compiled context, and a `jarvis.memory.record.forgotten` tombstone records id + reason + actor while containing **none** of the forgotten content. Repeating the forget is a no-op, not an error.
- Boundaries hold: memory ≠ event log (episodes are curated derivations with their own retention), memory ≠ world model (coupling is an evidence pointer only), vector distance ≠ truth (similarity is one bounded factor of seven and never consulted for contradiction resolution).

**Context privacy**
- Labels survive retrieval and compilation: ATLAS fact and MNEMOSYNE episode privacy classes reach the `ContextItem`, and `maxPrivacyOf` escalates the package to the most sensitive item present.
- Items above the requested ceiling are **dropped, not downgraded**.
- Agents cannot strip labels: `AgentRuntime` mutates only budget fields; `privacyClass`, `locality` and `cloudAllowed` pass through unchanged (probed).
- **The attack fails at two independent layers.** With only cloud models registered, a request carrying `privacyClass: 'RESTRICTED'` plus `locality: 'any'` and `cloudAllowed: true` yields zero candidates and `NO_ROUTE` — the Model Gateway refuses regardless of what the Kernel asked for. With a local model present, `SENSITIVE`/`RESTRICTED` selects it exclusively. Separately, the Kernel forces `locality: 'local'` + `cloudAllowed: false` and fails closed when `modelLocalRouteAvailable` is false.

**Session security** — every listed attack was attempted and refused: forged bearer, sub-minimum-length bearer, wrong scheme, absent header, token from a different node, token from a different session, token missing a required scope, expired token, token after logout (session ended), revoked identity, disabled principal, revoked node, weak credential against an approval's `strong` requirement, stale credential against the five-minute approval freshness window, and a previous-generation token after rotation.

**Adapter trust** — the host generates a per-invocation IPC secret and nonce; a reply must carry a binding whose `invocationId`, `capabilityId`, `action`, `nonce` and `issuedAt` all match and whose HMAC-SHA256 verifies under `timingSafeEqual`, with an explicit staleness bound. Worker spoofing, stale replies and wrong-invocation replies are structurally rejected. Worker crash containment and deadline kill are exercised against real spawned workers.

**Observability** — a registered `NodeSDK` exports genuine spans carrying the declared service identity; `currentTraceId()` inside an active span returns a real 32-hex id; the Event Manager stamps it onto the durable `events.events` row; and the exported span is joinable to that row. No secret, raw audio or raw video appears in span attributes.

**Disaster recovery** — `DISASTER RECOVERY PASS: pg_dump artifact restored, Kernel booted, and durable completed invocation was not re-executed.`

---

## UNVERIFIED FUNCTIONALITY

Explicitly not proven. Do not cite RC1 as evidence for any of these.

1. **Voice against hardware** — microphone capture, speech recognition, wake word, audible TTS, conversational follow-up, barge-in, and acoustic echo self-trigger. `pnpm hardware:validate` marks every one `NOT TESTED`; it confirms only that a microphone and speaker endpoint are *present*.
2. **Vision against hardware** — MediaPipe hand tracking, Air Touch gesture recognition, selected-frame cloud vision, screen capture in anger, camera loss/reconnect.
3. **Multi-monitor behaviour** — one active display on the audited host.
4. **The defining JARVIS moment** — "Jarvis." → point → "What's that?" → follow-up. This requires interactive speech, a gesture, and a configured vision-capable provider. It was **not** performed. Subsystem composition is therefore proven only as far as the automated context/cognition path goes.
5. **Live cloud provider calls** — no API keys in the audited build; provider adapters are exercised against fakes and failure-injection only.
6. **Remote node participation** — no node can enroll or heartbeat over the wire (no ingress). Enrollment, admission, timeout, reconnect, rotation, revocation and isolation are proven at the manager level with a fake store, not over a network.
7. **Kernel behaviour under real dependency outage** — the chaos gate proves the fault-injection mechanisms, not JARVIS's reaction to them.
8. **The repaired desktop client against a live Kernel** — the fix is unit-tested; the Tauri app was not run.

---

## REMAINING TECHNICAL DEBT

### Blockers
**None.** Every defect that would have blocked RC1 was repaired in this pass.

### Non-blockers, ranked

**P1 — address before MK.43 builds on them**
1. **Node Protocol has no ingress.** `apps/core/src/kernel/nodes/` is a library with no `/nodes/*` route; `enroll`/`heartbeat`/`rotateKey` have no production caller. Distributed work must not assume nodes can join.
2. **Span coverage is two paths wide.** Add explicit spans across ingress → Context → cognition → agency → adapter → verification, replace the inert `instrumentation-pg` with real `postgres.js` tracing, and add undici instrumentation for outbound `fetch`.
3. **Chaos does not touch a live Kernel.** Stand up a Kernel against real NATS/Redis/Postgres, kill each, and assert the documented degradation and recovery.
4. **Verification reads through the audited adapter.** Provide at least one out-of-adapter verification world for `HIGH`/`CRITICAL` actions so a malicious adapter cannot lie consistently.
5. **Single-factor root of trust.** `authStrength: 'strong'` is asserted by the ingress from a shared bootstrap secret; there is no second factor behind `authTrustLevel: 'verified'`, which gates `CRITICAL` dual control.
6. **No startup guard on dev defaults.** Refuse to boot when `bootstrapCredential` is still `dev-bootstrap-secret` and `diagnosticsHost` is not loopback.

**P2 — hygiene**
7. `/diagnostics` and `/state` are unauthenticated (loopback-bound). Any local process can read full system state.
8. Privacy classification is caller-asserted; the mediator performs no content-aware sensitivity detection.
9. A missing `privacyClass` on a model request defaults to `INTERNAL` and is cloud-eligible. Pinned by a test so a change is deliberate; consider defaulting to local-only.
10. `SessionCredentialManager.authenticate` contains a tautological `timingSafeEqual` comparing a value with itself. Harmless — the hash lookup is the real check — but it reads as a control that is not one.
11. `/auth/logout` transitions the session with `expectedVersion: -1`, bypassing optimistic concurrency.
12. `SessionCredentialManager.rotate` issues the new credential before revoking the old; a failure between the two leaves both live.
13. The DR drill restores into the same container, so it does not exercise a separate storage target or host.
14. `credentials.validity()` treats a `disconnected` node as live (only `revoked`/`isolated` invalidate). Benign while there is no heartbeat ingress; revisit when there is.
15. `COGNITION_MODEL` §4 still specifies `ContextFrame` while the runtime emits `ContextPackage`; the implementation note bridges this but the contracts should converge.

---

## SECURITY FINDINGS

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | Static ingress tokens (`dev-desktop-token` etc.) remained as a second, weaker authentication path on the desktop/voice/vision gateways after the ingress moved to session credentials — dead code that a future route could have re-adopted. A unit test still asserted the dead control as a "security boundary". | Medium (latent) | **Fixed** — methods, config fields and the misleading test removed. |
| S2 | `DesktopGateway.decide` hardcoded `authTrustLevel: 'verified'`, so the trust assertion gating `CRITICAL` dual control lived entirely in the HTTP caller. | Medium (latent) | **Fixed** — trust is now supplied by the authenticated credential and defaults to `trusted`. |
| S3 | Bootstrap credential is the single root of trust; `strong` is asserted, not proven; default value is a well-known constant with no bind guard. | Medium | Open (P1 #5, #6). |
| S4 | `/diagnostics` and `/state` unauthenticated on loopback. | Low | Open (P2 #7). |
| S5 | Tautological `timingSafeEqual` reads as a constant-time credential comparison but compares a value with itself. | Informational | Open (P2 #10). |
| S6 | Verification read is performed by the same adapter module under test. | Medium (design) | Open (P1 #4). |

No unauthorised access was achieved in any of the fifteen session-security attacks attempted. No credential could be fabricated. No path was found by which a model, agent, perception surface or the desktop reaches an effect without traversing the Executor.

---

## PRIVACY FINDINGS

| # | Finding | Severity | Status |
|---|---|---|---|
| P1 | The documented privacy-deletion path was unreachable: `MnemosyneStore.forgetEpisode` and `AtlasStore.forgetEntity` had **no callers**, and the `jarvis.memory.record.forgotten` / `jarvis.world.record.forgotten` tombstones were never emitted, despite `MNEMOSYNE_MODEL` §8 specifying them as the right-to-erasure mechanism. | **High** | **Fixed** — mediator `forgetMemory`/`forgetWorldEntity` wired, content-free tombstones emitted, proven by integration probe. |
| P2 | `classifyPrivacy` was a dead ladder: every branch after the caller hint returned `INTERNAL`, so the `derivedFromUntrusted` branch was inert and an untrusted-derived item could be hinted `PUBLIC`. | Medium | **Fixed** — untrusted-derived can never be `PUBLIC`; the caller-asserted limitation is now documented rather than disguised. |
| P3 | Privacy classes are caller-asserted with an `INTERNAL` default; no content-aware detection. | Medium | Open (P2 #8). |
| P4 | A model request with no `privacyClass` is treated as `INTERNAL` and is cloud-eligible — the one place a missing label does not fail closed. | Low | Open, pinned by test (P2 #9). |

**Enforcement that does hold:** labels survive retrieval and compilation; over-ceiling items are dropped rather than downgraded; agents cannot strip labels; and `SENSITIVE`/`RESTRICTED` context is refused a cloud route by both the Kernel and, independently, the Model Gateway registry. No raw audio or video is persisted or exported in traces.

---

## FAILURE / RECOVERY FINDINGS

- **Disaster recovery is real and passes.** Dump artifact → drop → create → restore → invariant check across six tables → real Kernel boot → completed invocation not re-executed.
- **Restart safety is real.** Expired in-flight effects are classified, not re-run; lease takeover only after expiry; rollback state survives restart when a pre-state exists.
- **Degradation logic is real but deterministically tested.** A critical subsystem going unhealthy drives `DEGRADED` and recovers; Redis loss does not touch authority. What is missing is fault injection under a live Kernel (P1 #3).
- **Gate correctness was broken and is fixed.** `scripts/run-it.mjs` had no Docker guard, so without a daemon vitest exited 0 with every integration suite `describe.skipIf`-skipped. This was reproduced live (a `verify:full` reporting success with 57 integration tests and the DR drill skipped). The runner now hard-fails, matching `run-chaos.mjs` and `backup-restore-drill.mjs`. CI on `ubuntu-latest` pulls `pgvector/pgvector:pg16` and runs the full chain on every push and PR to `main`.
- **Node liveness never ran.** `NodeManager.sweep()` returned `[]` and `markTimedOut` had no caller, so a departed node stayed `connected` forever while ADR-0037 claimed liveness was implemented. Now a real sweep on a `node.liveness_sweep` routine emitting `jarvis.infra.node.disconnected`.

---

## HARDWARE VALIDATION EVIDENCE

`pnpm hardware:validate` on the audited host (Windows on Snapdragon):

```
PRESENT    microphone device - Microphone Array (Qualcomm(R) Aqstic(TM) ACX Static Endpoints Audio Device)
PRESENT    speaker / TTS endpoint device - Speakers (Qualcomm(R) Aqstic(TM) Audio Adapter Device)
PRESENT    camera device - Qualcomm(R) Spectra(TM) 695 ISP Camera ... (7 device nodes)
PRESENT    monitor topology - [{"DeviceName":"\\.\DISPLAY1","Primary":true,"Width":1536,"Height":864}]
NOT TESTED multi-monitor / microphone capture / recognition / wake / spoken TTS audibility /
           conversation / follow-up / barge-in / physical echo self-trigger /
           MediaPipe / hand tracking / Air Touch / selected-frame vision / device loss / reconnect
```

`rawAudioPersisted: false`, `rawVideoPersisted: false`.

**Defect found and fixed here:** the validator previously reported `PASS` for microphone, speaker and camera *even when it found none*, with the evidence string reading "No active microphone identified". Absence was being rendered as success. It now reports `PRESENT`/`ABSENT` and never claims capability from presence.

Consequently: **presence is the only hardware fact RC1 establishes.** Voice, vision and spatial interaction scores reflect that.

---

## EXACT COMMANDS EXECUTED

Investigation (representative):
```
git fetch origin && git log --oneline -20 && git status --short
git show --stat 2cc3822 ; git show --stat 010114f
docker version --format '{{.Server.Version}}'                      # 29.7.2
wc -l apps/core/src/kernel/nodes/*.ts packages/telemetry/src/*.ts
grep -rn "desktopToken|voiceToken|visionToken|dev-bootstrap-secret" apps packages
grep -rn "JARVIS_REAL_CHAOS|forgetEpisode|forgetEntity|MemoryForgotten"
grep -rn "withSpan|currentTraceId|trace_id"
grep -rn '"pg"' --include=package.json apps packages                # no results
```

Verification:
```
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:contract
pnpm test:security
pnpm fitness
pnpm test:chaos
pnpm backup:drill
pnpm build:desktop
pnpm verify:full                                                   # full chain, twice
pnpm hardware:validate
node scripts/hardware-validate.mjs
JARVIS_GATE=security pnpm exec vitest run test/security/release-audit.security.test.ts
JARVIS_IT=1 pnpm exec vitest run apps/core/test/observability.integration.test.ts
pnpm exec vitest run apps/core/src/kernel/nodes
pnpm exec vitest run apps/desktop/src/experience/scene-client.test.ts
```

---

## TEST RESULTS

**Entry baseline (`010114f`, `verify:full`, exit 0):**

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | clean |
| unit | 37 files, 186 tests pass |
| integration | 10 files, 56 tests pass, **0 skipped**, real ephemeral Postgres |
| contract | 4 files, 16 tests pass |
| security | 2 files, 17 tests pass |
| fitness | 2 files, 17 tests pass |
| chaos | 2 files, 13 tests pass |
| backup:drill | `DISASTER RECOVERY PASS` |
| build:desktop | pass |

**New adversarial coverage added by this audit:** 22 tests, all green —
13 in `test/security/release-audit.security.test.ts` (privacy→cloud forcing, label survival, agent label-stripping, forged/malformed/mis-bound credentials), 3 in `apps/core/test/atlas-mnemosyne.integration.test.ts` (epistemic ceiling, provenance/confidence rejection, privacy deletion + tombstone), 4 in `apps/core/test/observability.integration.test.ts` (provider liveness, documented instrumentation gap, ledger↔trace correlation, no secrets in spans), plus 2 `NodeManager` liveness tests.

**Exit verification — post-fix, this is the certified state:**

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | clean |
| unit | 37 files, **187** tests pass |
| integration | **11 files, 63 tests pass, 0 skipped**, real ephemeral Postgres |
| contract | 4 files, 16 tests pass |
| security | 3 files, **30** tests pass (includes the 13 new attack probes) |
| fitness | 2 files, 17 tests pass |
| chaos | 2 files, 13 tests pass |
| backup:drill | `DISASTER RECOVERY PASS: pg_dump artifact restored, Kernel booted, and durable completed invocation was not re-executed.` |
| build:desktop | pass |

**Environment note, recorded for honesty.** The first post-fix `verify:full` run
aborted at the contract gate with a Windows `Access is denied` / `bash: fork:
Permission denied` — process-resource exhaustion on the audit host, not a test
failure (no test executed). The host was carrying ~20 long-lived Node processes
including MCP servers, Codex runtimes and a `pnpm core:dev` (`tsx watch`) Kernel
in watch mode that had been restarting on every edit. The remaining gates were
then run individually and all passed. This is an audit-host observation, not a
repository defect, but it is worth knowing that the full chain is heavy enough to
contend for resources on a loaded Windows workstation; CI (`ubuntu-latest`) runs
it cleanly. Nothing was killed to obtain the passing result — the user's dev
Kernel and MCP servers were left running.

---

## FIXES MADE DURING AUDIT

| # | Defect | Repair |
|---|---|---|
| 1 | `scripts/run-it.mjs` had no Docker guard — the mandatory integration gate exited 0 with every suite skipped. Reproduced live. | Hard-fail with `MANDATORY INTEGRATION GATE FAILED`, matching the chaos and DR runners. |
| 2 | `NodeManager.sweep()` returned `[]`; no routine called `markTimedOut`; ADR-0037 claimed liveness shipped. | Real sweep over `NodeStore.listStale`, new `node.liveness_sweep` routine emitting `jarvis.infra.node.disconnected`, 2 new unit tests (including idempotency). |
| 3 | `completeProvenance` fabricated `method`/`producedBy` for any caller, contradicting `ATLAS_MODEL` §3 ("the mediator rejects a fact without it"). | Mediator no longer invents origin; fact-bearing ingestion is rejected with a rationale when provenance is absent/invalid, and when confidence is outside 0..1. |
| 4 | The epistemic-status ceiling existed only in the agent facade, so any direct `extracted_fact` caller could store `observed`/`asserted`. | `capEpistemicStatus` in the mediator: `observed` requires `provenance.method === 'sensor'`; `asserted` requires a principal Command; otherwise downgraded to `inferred`. |
| 5 | `classifyPrivacy` was a dead ladder (all branches `INTERNAL`); untrusted-derived could be hinted `PUBLIC`. | Untrusted-derived can never be `PUBLIC`; the caller-asserted limitation documented honestly. |
| 6 | Privacy deletion unreachable: `forgetEpisode`/`forgetEntity` had no callers; tombstone events never emitted. | `forgetMemory`/`forgetWorldEntity` on the mediator emitting content-free tombstones; integration probe asserts removal from store, recall and context, and that the tombstone leaks no content. |
| 7 | `hardware-validate.mjs` reported `PASS` with evidence "No active microphone identified". | `PRESENT`/`ABSENT`; capability never inferred from presence. |
| 8 | `infrastructure.chaos.test.ts` claimed to chaos-test NATS/Redis/Postgres/Model-Gateway/Adapter-Host with JARVIS never in the loop; `JARVIS_REAL_CHAOS` was set and read by nothing. | Renamed and documented as host-level fault-injection *mechanism* tests, with the live-Kernel gap stated in the file and recorded as debt; dead flag removed. |
| 9 | Dead static-token `authenticate()`/`authorises()` on three gateways plus `desktopToken`/`voiceToken`/`visionToken` config defaults; a unit test asserted the dead control as a security boundary. | All removed; the vision test now covers only the controls that are actually in the path. |
| 10 | `apps/desktop` still sent a static `dev-desktop-token` and could never authenticate against the hardened ingress — the shipped UI was functionally dark. | Client migrated to `/auth/session` with node/session headers and 401-triggered re-exchange; its test now asserts a minted credential and the binding headers. |
| 11 | `DesktopGateway.decide` hardcoded `authTrustLevel: 'verified'`. | Supplied by the authenticated credential; defaults to `trusted` (fail-closed). |
| 12 | ADR-0037 contradicted itself — status claimed enrollment/liveness implemented while the note below stated no such code existed. | Rewritten against verified code: Part B delivered, Part A library-only with no ingress, explicitly stating remote nodes cannot join. |
| 13 | Registered `@opentelemetry/instrumentation-pg` is structurally inert (patches `node-postgres`; this repo uses `postgres.js`, and `pg` is not a dependency) while implying database trace coverage. | Documented in `packages/telemetry` and pinned by an integration test that will fail loudly if real database tracing is added. |

Plus: `README.md` "Current status" rewritten to describe RC1 truthfully — session credentials closed the logout gap, observability is real but partially covered, DR is real, Node Protocol is a library without ingress, chaos scope is bounded, and voice/vision/spatial hardware capability is explicitly **not proven**.

---

## FALSE-CONFIDENCE SWEEP

| Hunted for | Result |
|---|---|
| Misleading README status | **Found** — claimed observability was a no-op and the DR drill was not real (both stale/false in the other direction), claimed working voice/vision without hardware proof. Rewritten. |
| ADR says IMPLEMENTED but code absent | **Found** — ADR-0037 claimed liveness; `sweep()` returned `[]`. Fixed in code and in the ADR. ADR-0036 was already honest (`PARTIAL`). |
| Empty packages | **Found, benign** — `packages/{world-model,memory,context,kernel,state,events,objectives,protocol,...}` are README pointers to `apps/core/src/kernel/*`. Documented as extraction seams, not implied implementations. |
| Unused interfaces | **Found** — dead gateway `authenticate`/`authorises`, unused `desktop/voice/vision` tokens, dead `JARVIS_REAL_CHAOS`, `AdapterRunner.verify?` never called (deliberate — the fitness gate enforces it). Dead auth removed. |
| "integration" tests that are unit tests | Not found — all 11 integration files spin real ephemeral Postgres containers. |
| "chaos" tests that assert hand-made objects | **Found** — mislabelled infrastructure chaos. Renamed truthfully. |
| Hardware claims from synthetic input | **Found** — `PASS` on device absence. Fixed. |
| Diagnostics showing fake values | **Found** — the same `PASS`. Otherwise clean: `DiagnosticsService` marks `rtc` `placeholder: true` and reports real ATLAS/MNEMOSYNE counts, open conflicts and last consolidation. |
| TODOs hidden in critical paths | Not found — the lint gate rejects bare `TODO`, `@ts-ignore` and `as any`; it reports clean. |
| Commented-out security | Not found. |
| Permissive dev defaults usable outside dev | **Partly** — `dev-bootstrap-secret` with no non-loopback bind guard (P1 #6). Dead ingress-token defaults removed. |
| Hardcoded credentials | Not found — secrets come from env with dev fallbacks; no credential literals in source. |
| Provider credentials leaking beyond the Gateway | Not found — enforced by two fitness rules; provider SDKs and wire shapes exist only in `apps/gateway`. |

---

## CONDITIONS ON THE GO

RC1 is certified for what it is: a hardened, single-node agency and knowledge platform with honest instrumentation. MK.43 must not build on any of the following as if it were delivered:

1. Remote node participation (no ingress).
2. Full-chain distributed tracing (two explicit spans).
3. Kernel resilience under real dependency outage (untested).
4. Any voice, vision or spatial interaction capability (hardware unverified).
5. Verification independent of the adapter under test.

Address P1 #1–#6 before the distributed phase, and perform the interactive hardware validation before any claim that JARVIS can be spoken to.
