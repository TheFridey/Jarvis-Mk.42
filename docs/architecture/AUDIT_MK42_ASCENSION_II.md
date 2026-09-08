# AUDIT — MK.42 ASCENSION II

**Auditor:** External Principal Architect / distributed-systems engineer / AI-systems reviewer / security auditor (Claude, acting hostile-adversarially; model instance is Sonnet 5, not the Opus 5 requested — noted for the record since it materially affects nothing in this audit's method).
**Date:** 2026-09-08
**Commit audited:** `591fdda` (`fix: keep vision presence evidence honest`), branch `main`, verified `git fetch` up to date with `origin/main`.
**Prior audit:** `docs/architecture/AUDIT_MK42_ASCENSION.md` ("Stage A", 2026-09-03) found the Agency Plane hollow — modules existed but nothing was wired, `REQUIRE_APPROVAL` auto-approved, the credential broker fabricated secrets on cache miss, invocation state was an in-memory `Map`, and verification trusted the adapter. ADRs 0031–0038 were written as the Stage B hardening brief. This audit's job was to verify, from code and running tests only, whether that brief was actually delivered — and to audit everything shipped since (cognition, voice, vision) with the same hostility.

**Method:** did not trust any prior claim, ADR title, commit message, or memory record. Read the constitution, every relevant ADR, and the actual implementation files for each area in the brief. Dispatched five independent adversarial sub-audits (kernel spine, cognition plane, agency/security-plane attack checklist, voice/vision/Air Touch, infrastructure/CI) each required to cite `file:line` evidence and grade every claim as working / partial / stub / doc-only. Ran the full quality-gate chain (`typecheck`, `lint`, `test`, `test:integration`, `test:contract`, `test:security`, `fitness`, `test:chaos`, `backup:drill`, `build:desktop`) against real infrastructure (Docker-backed Postgres), not the Docker-absent skip path. Fixed defects that were reasonably repairable within this session and re-verified after each fix.

---

## Executive verdict

**CONDITIONAL GO** for MK.43, with named exceptions.

The Stage A verdict was "architecture-as-designed 9/10, architecture-as-built 4/10, security-as-built 3/10" because the Agency Plane was hollow. That specific verdict is **overturned by this audit**: the agency/security plane is now genuinely built, and a dedicated 18-point bypass-attack pass (single Executor bypass, direct desktop/adapter invocation, model-output bypass, replay re-execution, stale approval replay, argument tampering, duplicate/race execution, lease theft, spoofed verification, privilege escalation, expired permission, stolen session, Kernel restart mid-action, Adapter Host crash, rollback failure, credential fabrication, policy fail-open, auto-approval) found **no successful critical bypass**. That is a materially different system than the one Stage A audited.

At the same time, this audit found and, in one case by direct reproduction, confirmed that **two ADRs (0036, 0037) describe capabilities as delivered when they are not**, that **two named subsystems (ATLAS, MNEMOSYNE) exist only as documentation and empty package stubs** despite being load-bearing nouns throughout the architecture docs, and that **the quality-gate chain itself had a live false-confidence defect** — a Docker-availability check with no retry, compounded by a container-leak-on-hook-timeout bug, that caused 4 of 10 real integration suites (including the durable-agency lifecycle tests) to silently self-skip while the gate still reported green. That defect was reproduced live during this audit, root-caused, and fixed (see "Fixed defects" below); the full suite now passes for real, against real Postgres, with all containers cleaned up.

The system is not the thing its most confident documentation claims it to be. It is also not the hollow shell Stage A found. It is a working, enforced agency plane with working cognition, voice, and vision, sitting on top of an event-sourced kernel spine that is genuinely solid — with real, specifically-located gaps that must not be papered over before MK.43.

---

## Scores (0–10, evidence-based, not aspirational)

| Dimension | Score | Basis |
|---|---|---|
| Architecture (as designed) | 9 | Constitution, 38 ADRs, and threat model remain coherent and internally consistent; ADR-0037's title was the one dishonest artifact found and has been corrected in this audit. |
| Runtime completeness | 6 | Kernel spine, agency plane, cognition, voice, vision are real. Node Protocol, real telemetry, ATLAS, MNEMOSYNE are not. |
| Security (agency plane) | 8 | No critical bypass found across 18 adversarial attempts; two residual gaps (unsigned worker replies, session tokens not revoked on logout) are real but non-critical in the current single-process, single-user deployment shape. |
| Reliability | 6 | Kernel restart, lease recovery, rollback, and idempotent replay are real and tested against real Postgres. The quality-gate chain itself had a false-confidence defect (see below), now fixed. Backup/restore is a round-trip test, not disaster recovery. |
| Observability | 2 | `packages/telemetry` is OTel API surface with no registered provider anywhere; zero real spans, zero trace correlation, despite ADR-0036 and infra config implying otherwise. |
| Cognition | 8 | Objective→Executor single-pipeline boundary holds under adversarial tracing. Model Gateway is genuinely provider-neutral with isolated secrets. Malformed/off-manifest model output is rejected before it can act. ATLAS/MNEMOSYNE absence is the main deduction. |
| Voice | 8 | Locally-recognized text only crosses the process boundary; session state lives in the Kernel; barge-in and device-loss recovery are real and integration-tested. No fake hardware claims found. |
| Vision | 8 | Frames stay local by default; cloud vision requires an explicit approved selected-frame path; Air Touch is signal-only; gesture ambiguity does not silently resolve to action. The one fake-hardware-claim pattern the brief anticipated (inferring "person absent" from a hand-tracker that cannot detect absence) was found — and was already fixed in the commit under audit, 591fdda. |
| Experience integration (desktop) | 7 | Desktop routes every action through the same Agency Ingress as voice/vision/cognition; no direct-to-adapter path exists from the UI. Build succeeds; a static bearer token (not a rotating session) gates the gateway RPC surface. |

---

## Systems confirmed working (code-verified, not documentation-verified)

- **Kernel composition** (`apps/core/src/kernel/lifecycle/kernel.ts`) — real constructor-injected assembly of ~20 components, documented cold-start order, verified end-to-end by `kernel-lifecycle.integration.test.ts` including a real **restart-recovery** test against the same Postgres.
- **State Manager** — single authoritative writer per slice via row-locked optimistic-concurrency transactions (`state-manager.ts`); two concurrent writers cannot both win.
- **Event Fabric** — transactional outbox (event + outbox row in one tx) relayed to real NATS JetStream with durable consumers and explicit ack/nak; forged agency lifecycle events from non-Executor sources are hard-rejected.
- **Event replay** — separate `ReplayBus` channel, `meta.replay` tagging, and a projector that only applies forward version progress — genuinely idempotent, verified by `event-fabric.integration.test.ts`'s "re-append with the same id does not duplicate" case.
- **Durable invocation lifecycle (ADR-0033)** — production wiring uses `PgInvocationStore`, not the in-memory `Map` Stage A found; row-locked transitions, idempotent history recording. This is the single clearest "Stage A defect actually fixed" finding.
- **Agency Plane, end to end** — Policy Engine is fail-closed by default above LOW risk; Approval Manager requires single-use, nonce/version-checked, hash-bound approval (approved arguments cannot be swapped post-approval); Credential Broker fails closed on cache miss (no more fabricated secrets) and never serializes real secret material to worker processes; resource leases are transactionally fenced against theft; `AgencyRecovery` safely reconstructs interrupted invocations on Kernel restart without re-executing them; reversible-action rollback is independently re-verified, not adapter-self-reported.
- **Objective→Executor single pipeline (ADR-0016)** — traced end to end from objective creation (hardcoded `mayExecute:false`) through `CognitionOrchestrator` → `AgentRuntime` (schema + manifest-scope validation) → `AgencyIngress` (independent re-validation) → `CapabilityExecutor`. No side-effecting call was found reachable from objective/cognition code that skips this chain.
- **Model Gateway** — real multi-provider adapters (Anthropic/OpenAI/OpenAI-compatible) behind one interface with circuit breakers, retry-on-retryable-only semantics, and API keys that never appear in any request/response type reachable by model output.
- **Voice** — local Windows speech recognition; only post-activation text (never raw audio) crosses the process boundary; Kernel owns session state; barge-in and device-loss recovery are real and tested.
- **Vision / Air Touch** — continuous frames never leave the process; an explicit, approval-gated selected-frame path exists for cloud vision; Air Touch gestures are pure presentation signals that still require full approval for any world-affecting action; low-confidence gestures are held ambiguous rather than silently executed.
- **NATS and Postgres** — both are real, load-bearing infrastructure, not documentation references.
- **CI** (`quality.yml`) — runs the exact `verify:full` step sequence with no disabled or allow-failure gates.

## Systems partially working

- **Sessions / bearer tokens** — `SessionManager` has a real, well-tested state machine, but gateway authentication (`desktop-gateway.ts`, `voice-gateway.ts`) uses a single static shared-secret bearer token, not a per-session token with expiry. Logging out (`SessionManager.transition(..., 'ended')`) does **not** revoke the credential used to authenticate subsequent requests. In the current single-operator deployment shape this is a bounded gap, not a critical one — but it is real and should not survive into a multi-user or networked MK.43.
- **Verification of worker/adapter results** — `VerificationRunner` correctly refuses to trust the adapter's self-reported outcome and independently re-reads world state, but that independent read still goes through the same `AdapterHost`/worker module. A compromised adapter could in principle lie consistently across both the execute and verify calls, since there is no cryptographic signing of worker replies. Not exploitable by a model or agent under the current threat model (adapters are operator-installed, not model-authored), but worth closing before third-party or FORGE-authored adapters are trusted.
- **Backup/restore drill** — genuinely runs against real Postgres (verified in this audit, 38s wall time, real container) and legitimately proves transactional round-tripping of Kernel/World-Model/memory/invocation/policy/permission rows. It is not, and must not be described as, a disaster-recovery drill: there is no `pg_dump`/`pg_restore`, no separate storage target, and no process restart in the path.
- **Chaos and fitness gates (ADR-0038)** — real enough to fail on a genuine violation (confirmed: `architecture.fitness.test.ts` does regex/text matching against real file contents, `foundation.chaos.test.ts` does exercise real state-machine failure-handling logic including an actual Adapter Host worker crash/timeout), but neither is what its name implies: fitness checks are text-pattern matching, not compiler-API/dependency-graph analysis; chaos tests are deterministic synthetic-input unit tests, not fault injection against running infrastructure. Real, but over-named.

## Systems not working / not implemented

- **ATLAS (world model)** and **MNEMOSYNE (memory)** — both named prominently across `ATLAS_MODEL.md`, `MNEMOSYNE_MODEL.md`, ADR-0020/0021/0022/0023, and referenced by the Constitution — have **zero implementation**. `packages/world-model` and `packages/memory` contain only `README.md`. The closest real artifact is a flat key/slice `StateManager`, which is a much thinner structure than either document describes. `ContextCompiler` never calls a memory/recall service of any kind. ADR-0022 (consolidation) and ADR-0023 (retrieval ranking) have no implementing code anywhere.
- **Observability contract (ADR-0036)** — `packages/telemetry/src/index.ts` is explicit about this itself ("Wiring a real SDK + OTLP exporter is a follow-up"): `startTelemetry()`/`stopTelemetry()` are empty, no `TracerProvider` is ever registered anywhere in the codebase, `withSpan()` has zero call sites in `apps/core/src`, and `currentTraceId()` always returns `undefined` in production. There is no ledger↔trace correlation. The ADR's title claims a "real OTel SDK" and "mandatory spans" — neither exists at runtime.
- **Node Protocol v1 (ADR-0037)** — `packages/protocol` is a README stub; `packages/contracts/src/node.ts` defines only data-shape interfaces. There is no admission service, no enrollment/rotation/revocation code, no `projections.nodes` table in any migration, and no heartbeat consumer. Every event's `source.node` is still the single static `config.nodeId` constant — exactly the pre-ADR problem state the ADR itself describes. **This ADR's original title asserted the work was done; it was not.** Corrected in this audit (see "Fixed defects").
- **Multi-user identity** — schema supports multiple identity kinds and trust levels, but no routing/isolation is exercised anywhere; a single `bootstrapPrincipalId` flows through every gateway.

---

## Critical defects

None found in the agency/security plane under the 18-point adversarial attack pass (bypass Executor, direct desktop/adapter action, model-output bypass, replay re-execution, stale approval replay, argument tampering, duplicate/race, lease theft, spoofed result/verification, privilege escalation, expired permission, stolen session, Kernel restart mid-action, Adapter Host crash, rollback failure, credential fabrication, policy fail-open, auto-approval). This is the single most important finding of this audit and directly overturns Stage A's "security-as-built 3/10."

One **critical process defect** was found and fixed during this audit (not in application code, but in the quality-gate chain that is supposed to catch application defects):

- **CRITICAL — false-confidence integration-test skip.** `isDockerAvailable()` (`packages/testkit/src/pg-container.ts`) ran a single `docker ps` with no retry. Under the load of many sequential ephemeral Postgres containers, this check can transiently time out and be misread as "Docker unavailable," causing `describe.skipIf(!dockerOk)` suites to silently self-skip — including `durable-agency.integration.test.ts` (15 tests covering the exact agency-plane guarantees this audit was asked to attack) and `state-manager.integration.test.ts` (7 tests) — while the gate still reports **green** (skipped tests do not fail vitest). This was not theoretical: it was reproduced live during this audit (4 of 10 integration files skipped on one run despite Docker being installed and running). Root cause traced further: a prior run's `voice.integration.test.ts` hit a 240s hook timeout; because Node cannot cancel the underlying promise, the ephemeral container it had started (`jarvis-it-pg-...`) was never torn down (`ctx` in the test's `beforeAll` was never assigned, so `afterAll(() => ctx?.cleanup())` was a no-op) and was still running 17+ minutes later, degrading the Docker daemon badly enough that a bare `docker ps` took over 120 seconds. **Fixed** — see below.

## High-priority defects

1. **ADR-0037 falsely claimed completion in its own title.** Corrected in this audit; the ADR now states plainly that Node Protocol v1 and the disaster-recovery half of backup/restore remain design-only.
2. **Session/bearer-token revocation gap.** Logging out does not invalidate the static bearer token used to authenticate subsequent gateway requests; there is no per-session token issuance/expiry. Bounded by the current single-operator deployment shape, but must be closed before any multi-user or networked exposure.
3. **ATLAS and MNEMOSYNE are vaporware relative to their documentation weight.** Every architecture document treats them as load-bearing nouns. Neither exists. This is a documentation-vs-reality gap serious enough to mislead a future implementer or auditor who trusts the docs over the code.
4. **Observability contract is unmet despite ADR-0036 being "Accepted."** No spans, no metrics, no trace correlation exist at runtime. (ADR-0036's title is honest about this being unmet — the defect is that it was accepted and never executed, not that the ADR misrepresents it.)

## Medium-priority defects

1. **Backup/restore drill is materially narrower than its name.** It proves in-connection round-tripping, not disaster recovery. Its own test description ("authoritative backup and restore drill") overstates what it verifies. Recommend renaming and adding a real `pg_dump`/`pg_restore` drill before relying on it.
2. **Chaos and fitness gates over-name their rigor.** Both are legitimate, deterministic unit-level checks, but neither does what "chaos" (fault injection against running infrastructure) or "fitness" (compiler-API/dependency-graph analysis) conventionally implies. Recommend renaming in ADR-0038 and the scripts, or upgrading the implementation to match the name.
3. **Unsigned adapter/worker replies.** `VerificationRunner`'s independent re-read still trusts the same `AdapterHost`/worker trust boundary used for execution. Fine under the current "operator installs adapters" threat model; will not be fine once FORGE/third-party-authored adapters are trusted (ADR-0029).
4. **Screen-context metadata (window title/app/cursor) auto-transmits every second with no dedicated per-event consent/policy gate.** Metadata only, not pixels, but worth an explicit policy check given how much can be inferred from window titles alone.
5. **`presence-policy.ts`'s `camera_absence` evidence-vote path is now dead code** (nothing emits it, correctly, after the 591fdda fix) — should be removed or explicitly gated behind a real person detector rather than left as an unreachable branch that could be re-wired incorrectly later.
6. **Postgres migration numbering has a gap** (`0007` is missing from the sequence `0001…0006, 0008…0012`). The migrator sorts by filename and doesn't enforce contiguity, so nothing is broken, but it's an unexplained hole worth a one-line note in the migration README.
7. **No echo-cancellation guard on voice barge-in** — TTS played through open speakers could in principle self-trigger `speech-start` via the same microphone. Not observed failing, but not guarded against either.

## Technical debt

- `packages/kernel`, `packages/objectives`, `packages/agents`, `packages/capabilities`, `packages/state`, `packages/events`, `packages/context`, `packages/models`, `packages/sdk` are all README-only stubs; the real implementations live under `apps/core/src/kernel/*` and `apps/gateway/src/*`. This is a legitimate MK.43 deviation (documented at the top of `kernel.ts` as "modular monolith, not NestJS"), but the stub packages should either be deleted or clearly marked historical, since their continued presence actively misleads anyone navigating by the package layout the docs describe.
- Privacy-tiering logic in the Model Registry (`localOnly` routing for SENSITIVE/RESTRICTED) is currently dead code, because `CognitionOrchestrator` hardcodes every request to `INTERNAL` privacy class. Safe by omission today; will need real wiring once anything above INTERNAL is ever compiled into context.

## Privacy findings

- Voice: no raw audio leaves the process at any point, including pre-activation. Confirmed by code, not just by absence of a counter-example.
- Vision: continuous frames never leave the process; the Kernel's `vision-gateway.ts` hard-rejects any signal payload matching pixel/raw-frame patterns or exceeding 100KB, with a test proving the rejection. The explicit cloud-vision path requires a `local-object://` reference, blocks `RESTRICTED` privacy class outright, and fails closed without an `approvalRef`.
- Screen capture (pixels): cannot execute without policy approval (`risk: HIGH`, `approvalPolicy: always`). Screen-context metadata (titles/app/cursor) has no equivalent per-event gate (Medium-priority defect #4 above).
- The one fake-hardware-claim pattern anticipated by the audit brief — inferring camera-derived "presence absent" from a hand-tracker that structurally cannot detect absence — was found in the pre-591fdda code and was **already corrected by the commit under audit**, which removes negative-absence emission and documents why a dedicated person detector is required before it can be reintroduced.

## Security findings

Summarized under Critical/High/Medium above. The headline result: the 18-point bypass-attack checklist against the agency plane found **no successful bypass**. This is the most consequential result of this audit and should not be undersold by the number of unrelated documentation and process findings surrounding it.

## Stale / misleading documentation

- **ADR-0037** — title falsely asserted implementation. Corrected in this audit with an inline amendment (ADRs are historical records; the original decision text was preserved, a dated correction was added rather than rewriting history).
- **README.md** — previously hedged in the wrong direction: it undersold working cognition/voice/vision (calling them "incomplete" when they are substantively real per this audit) while not flagging that Node Protocol and telemetry claims elsewhere in the docs were unmet. Corrected in this audit.
- **`infrastructure/observability/README.md`** describes end-to-end tracing and roughly a dozen metrics that are not emitted anywhere. Not corrected in this audit (out of the reasonably-repairable scope for this pass — the honest fix is implementing the OTel SDK wiring, not editing more prose); flagged here so it is not mistaken for current behavior.

---

## Fixed defects (this session)

1. **`apps/core/test/security/boundary-sweep.test.ts`** shelled out to the `rg` (ripgrep) binary via `execFileSync`, which is not installed on this machine and not declared as a dependency anywhere in the repo. Two of five boundary-sweep security tests hard-failed with `ENOENT` rather than running. Replaced with a pure Node `fs.readdirSync`-based recursive file walker with identical semantics. Re-verified: all 5 tests pass.
2. **`packages/testkit/src/pg-container.ts`: `isDockerAvailable()`** did a single `docker ps` probe with no retry, causing transient Docker Desktop slowness to be misread as "Docker unavailable" and real integration suites to silently self-skip while the gate still reported green (see Critical defect above — this was reproduced live, not hypothesized). Added a 3-attempt retry with 1s backoff before concluding Docker is genuinely unavailable.
3. **`apps/core/test/it-harness.ts`: `setupIt()`** had no cleanup path for partial setup failure — if anything after container creation threw, the ephemeral Postgres container leaked, because the calling test's `ctx` variable was never assigned and `afterAll(() => ctx?.cleanup())` became a silent no-op. Wrapped the setup body in try/catch so any failure after container start still tears the container down before the error propagates.
4. **`scripts/run-it.mjs`** had no defense against a leak that outlives try/catch entirely — a vitest **hook timeout** aborts the test, not the underlying promise chain (Node cannot cancel a pending promise), so a beforeAll that hangs past `hookTimeout` can still leak its container after the test framework has already moved on. Added an unconditional post-run sweep that force-removes any `jarvis-it-pg-*` containers left behind, regardless of how the run exits. **This is the fix that matters most**: it makes the false-confidence failure mode structurally unable to recur, rather than just less likely.
5. **`docs/architecture/adr/0037-node-protocol-and-backup.md`** — corrected the title and added a dated audit note; see "Stale documentation" above.
6. **`README.md`** — rewritten "Current status" section to state verified reality: what genuinely works (agency plane, cognition, voice, vision), what doesn't (Node Protocol, telemetry, ATLAS, MNEMOSYNE), and the session-token gap, with an explicit pointer to this audit document.
7. **Reverted incidental `apps/desktop/out/*` diffs** produced by running `pnpm build:desktop` locally as part of gate verification — these are generated build artifacts, not part of the audit's actual changes, despite being (pre-existing, not introduced by this audit) tracked in git against `.gitignore`'s `out/` rule.

All fixes were verified by rerunning the affected gate(s) before moving on, and by a final full `verify:full`-equivalent pass (see Test Results below).

---

## Exact commands executed

```
git status
git fetch origin && git log --oneline -5 origin/main && git pull origin main
pnpm verify:full                      # first run: exposed the rg ENOENT defect
pnpm verify:full                      # second run: exposed the Docker false-skip defect (voice hook timeout, 4 files skipped)
docker info / docker ps -a / docker port …   # diagnosed the leaked jarvis-it-pg-* container
docker rm -f jarvis-it-pg-1788862490963-1183
pnpm test:integration                 # rerun after leak-sweep fix, healthy Docker: 10/10 files, 51/51 tests passed
pnpm test:contract                    # 4/4 files, 16/16 tests passed
pnpm test:security                    # 2/2 files, 17/17 tests passed
pnpm fitness                          # 2/2 files, 17/17 tests passed (includes the fixed boundary-sweep)
pnpm test:chaos                       # 1/1 file, 10/10 tests passed
pnpm backup:drill                     # 1/1 test passed, 38s, real ephemeral Postgres
pnpm build:desktop                    # Next.js static export succeeded
```

## Test results (final, real infrastructure)

| Gate | Files | Tests | Result |
|---|---|---|---|
| `typecheck` | — | — | clean |
| `lint` | — | — | clean |
| `test` (unit) | 27 | 136 | all passed |
| `test:integration` | 10 | 51 | all passed (real Docker-backed Postgres; includes kernel restart-recovery, event-fabric idempotency, cognition-to-executor round trip, and voice barge-in durability) |
| `test:contract` | 4 | 16 | all passed |
| `test:security` | 2 | 17 | all passed |
| `fitness` | 2 | 17 | all passed |
| `test:chaos` | 1 | 10 | all passed |
| `backup:drill` | 1 | 1 | passed (see caveats above re: scope) |
| `build:desktop` | — | — | succeeded (Next.js static export) |

No tests were reduced, skipped, or weakened to obtain this result. The integration suite specifically was made to pass for real (against real Postgres, with all 10 files actually executing rather than 4 silently skipping) rather than accepted in its previously green-but-partially-skipped state.

## Hardware actually tested

None. No physical webcam, microphone, or gesture hardware was exercised in this audit session — this was a static code and automated-test audit on a development machine. The vision/voice integration tests that passed exercise the Kernel-side code paths (session lifecycle, barge-in, gesture-signal routing, privacy gating) with synthetic/mocked input at the hardware boundary, not real device I/O.

## Hardware only simulated

Voice and vision integration tests use synthetic ASR events and a fake model gateway; no real microphone or camera was attached to this session. TEST H (Air Touch with real webcam hardware) from the audit brief could not be performed — no camera is available in this environment. This is stated plainly rather than inferred as a pass: **Air Touch was not validated against real hardware in this audit.**

## End-to-end validation performed

- **TEST A (Boot)** — performed via `kernel-lifecycle.integration.test.ts`: cold start to DORMANT→AMBIENT confirmed, diagnostics report answers with real numbers, bootstrap identity present. Real Postgres, no mocks.
- **TEST B (Conversation)** — performed via `cognition.integration.test.ts` and `voice.integration.test.ts`: context compiled, model gateway invoked (fake model, real gateway/orchestrator code), answer persisted and exposed to desktop; voice session round trip including follow-up and barge-in, against real Postgres and a real in-process Kernel.
- **TEST C (Safe action) / TEST D (Approval)** — performed via `cognition.integration.test.ts` ("routes a model action through approval and verified Executor completion") and the agency integration/security suites: proposal → Policy → Permission → Approval → Executor → Adapter → Verification, end to end, against real Postgres.
- **TEST E (Denial)** — covered by `agency.security.test.ts` (13 tests) and the fail-closed policy defaults confirmed in the agency-plane sub-audit; a denied action has no code path to execution.
- **TEST F (Restart during durable invocation)** — performed via `kernel-lifecycle.integration.test.ts`'s "survives a restart" case and confirmed separately by the agency sub-audit's static trace of `AgencyRecovery`: a second Kernel against the same Postgres recovers state and mode without re-executing in-flight invocations.
- **TEST G (Provider failure)** — performed via `apps/gateway/src/failure.test.ts` (8 tests): per-candidate circuit-breaker failure, retry-only-on-retryable, typed error propagation, no silent stale-data fallback.
- **TEST H (Air Touch, real hardware)** — **not performed**; no camera hardware available in this environment. Gesture-signal routing and ambiguity handling were verified from code and `packages/scene/src/scene.test.ts`, not from a live camera.

## Remaining work before MK.43

1. Decide and execute on ATLAS and MNEMOSYNE: either build them for real, or formally descope them from the MK.42/MK.43 boundary and rewrite the docs that currently treat them as shipped-adjacent.
2. Implement real OTel SDK registration (ADR-0036) — the API surface and design are already correct; only the provider registration and call sites are missing.
3. Decide the actual MK.43 scope for Node Protocol v1 (ADR-0037) — it is a large, real distributed-systems feature, not a small patch. Do not let its ADR imply otherwise again.
4. Close the session/bearer-token revocation gap before any multi-user or networked (non-localhost) deployment.
5. Add a real `pg_dump`/`pg_restore` (or equivalent) drill alongside the existing transactional round-trip test, and rename the latter so its scope is accurately described.
6. Sign or otherwise authenticate adapter/worker replies before FORGE-authored or third-party adapters are ever trusted (ADR-0029 dependency).
7. Validate Air Touch against real camera hardware at least once before claiming gesture interaction "works" in any user-facing material.

## GO / CONDITIONAL GO / NO-GO

**CONDITIONAL GO.**

The agency/security plane — the part of the system with the highest blast radius if wrong — passed a genuinely hostile adversarial review with no critical bypass found, and the quality-gate infrastructure that is supposed to keep it that way had a real false-confidence defect that was caught, root-caused, and structurally fixed (not patched around) in this same session. Cognition, voice, and vision are substantively real, not cosmetic.

The condition: MK.43 work must not build further on the assumption that ATLAS, MNEMOSYNE, Node Protocol, or observability exist, because they do not, regardless of how prominently they appear in the architecture documents. Item 1–3 above should be resolved (built, or formally descoped with docs corrected) before they become load-bearing assumptions for anything else.
