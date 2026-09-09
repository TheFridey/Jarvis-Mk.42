# MK.42 RC1.1 — Event Fabric Audit

**Auditor:** external distributed-systems + release auditor (Claude Opus 5), acting independently of the engineer who wrote the fixes.
**Date:** 2026-09-09
**Commit audited on entry:** `98b76be` (`fix: stabilise kernel health recovery lifecycle`)
**Scope:** JetStream subject ownership, real NATS runtime behaviour, dead-letter recursion, NATS outage/recovery, the DEGRADED → AMBIENT fix, and GitHub Actions.

**Method.** Codex's summary, source comments and test names were treated as unverified claims. Every conclusion below rests on code read directly, or on behaviour observed against a real `nats:2.10-alpine` server and a real `pgvector/pgvector:pg16` database. Where the repository's own helpers could have marked their own homework — most importantly the subject matcher in `stream-topology.ts` — the audit re-derived the answer with an independently written matcher applied to configuration read back **from the live server**, not from the source.

---

## JETSTREAM TOPOLOGY

Three streams, defined in [`stream-topology.ts`](../../apps/core/src/kernel/event-fabric/stream-topology.ts) and created by [`nats-bus.ts`](../../apps/core/src/kernel/event-fabric/nats-bus.ts).

| Stream | Subjects | Wildcards | Retention | `max_age` |
|---|---|---|---|---|
| `EPHEMERAL` | 12 | **none** | Limits | 10 minutes |
| `SECURE` | 15 | **none** | Limits | 30 days |
| `OPERATIONS` | 82 | **none** | Limits | 30 days |
| **Total** | **109** | — | — | — |

Ownership rule (`streamForEventType`), applied to the canonical set only — an unknown subject throws rather than defaulting:

- `jarvis.perception.*` → `EPHEMERAL`
- `jarvis.security.*`, `jarvis.kernel.identity.*`, `jarvis.kernel.policy.*`, `jarvis.kernel.permission.*`, `jarvis.agency.capability.*` → `SECURE`
- everything else canonical → `OPERATIONS`

### Why no two streams can match the same subject

The proof is structural, and it is stronger than a disjointness argument over patterns:

1. **Every configured subject is a literal.** `STREAMS` is built by filtering `Object.values(EventNames)`, so each subject is a fully-qualified, wildcard-free event name. Confirmed against the live server: zero of the 109 configured subjects contain `*` or `>`. There is therefore no `jarvis.>` catch-all, and no stream owns a superset of another's subjects.
2. **`streamForEventType` is a total function on the canonical set.** It returns exactly one of three names for every canonical input and throws for any non-canonical input. `STREAMS` partitions the canonical set by that function, so the three subject lists are pairwise disjoint by construction and their union is the whole set.
3. **Literal subjects match only themselves.** Two distinct literals cannot both match one subject. Combined with (1) and (2): every canonical event matches exactly one stream, no event matches zero, and no event matches two.

This does not depend on consumer-side `filter_subjects` to disambiguate anything. Consumer filters narrow delivery *within* an already-exclusive stream; they are not load-bearing for ownership. No comment or test in the repository claims otherwise (checked).

**Adversarial confirmation from the server itself.** With the three streams live, creating a fourth stream subscribing to `jarvis.>` was attempted. `nats-server` rejected it (`subjects overlap with an existing stream`). That is the topology property being enforced by the authority that matters, not by the repository's own validator.

---

## EVENT ROUTING TABLE

All 109 canonical events in [`packages/contracts/src/event-names.ts`](../../packages/contracts/src/event-names.ts). "Matches" is the number of **live streams on a running server** whose configured subjects match the event, computed with an independent NATS matcher (`*` = one token, `>` = one or more trailing tokens).

**Result: 109 / 109 events matched exactly one stream. Zero events matched zero streams. Zero events matched two or more. Zero configured subjects were orphans (every subject is itself a canonical event).**

| Event | Stream | Matches |
|---|---|---|
| `jarvis.agency.capability.deprecated` | SECURE | 1 |
| `jarvis.agency.capability.probation.cleared` | SECURE | 1 |
| `jarvis.agency.capability.probation.entered` | SECURE | 1 |
| `jarvis.agency.capability.registered` | SECURE | 1 |
| `jarvis.agency.capability_gap` | OPERATIONS | 1 |
| `jarvis.agency.grant.issued` | OPERATIONS | 1 |
| `jarvis.agency.grant.modified` | OPERATIONS | 1 |
| `jarvis.agency.grant.revoked` | OPERATIONS | 1 |
| `jarvis.agency.invocation.aborted` | OPERATIONS | 1 |
| `jarvis.agency.invocation.approval_expired` | OPERATIONS | 1 |
| `jarvis.agency.invocation.approved` | OPERATIONS | 1 |
| `jarvis.agency.invocation.awaiting_approval` | OPERATIONS | 1 |
| `jarvis.agency.invocation.compensated` | OPERATIONS | 1 |
| `jarvis.agency.invocation.denied` | OPERATIONS | 1 |
| `jarvis.agency.invocation.failed` | OPERATIONS | 1 |
| `jarvis.agency.invocation.partially_completed` | OPERATIONS | 1 |
| `jarvis.agency.invocation.policy_checked` | OPERATIONS | 1 |
| `jarvis.agency.invocation.proposed` | OPERATIONS | 1 |
| `jarvis.agency.invocation.rejected` | OPERATIONS | 1 |
| `jarvis.agency.invocation.rolled_back` | OPERATIONS | 1 |
| `jarvis.agency.invocation.simulated` | OPERATIONS | 1 |
| `jarvis.agency.invocation.started` | OPERATIONS | 1 |
| `jarvis.agency.invocation.step_completed` | OPERATIONS | 1 |
| `jarvis.agency.invocation.validated` | OPERATIONS | 1 |
| `jarvis.agency.invocation.verification_failed` | OPERATIONS | 1 |
| `jarvis.agency.invocation.verified` | OPERATIONS | 1 |
| `jarvis.agency.labs.run_finished` | OPERATIONS | 1 |
| `jarvis.agency.labs.run_started` | OPERATIONS | 1 |
| `jarvis.agency.lease.acquired` | OPERATIONS | 1 |
| `jarvis.agency.lease.broken` | OPERATIONS | 1 |
| `jarvis.agency.lease.released` | OPERATIONS | 1 |
| `jarvis.cognition.agent.invoked` | OPERATIONS | 1 |
| `jarvis.cognition.evidence.returned` | OPERATIONS | 1 |
| `jarvis.cognition.model.selected` | OPERATIONS | 1 |
| `jarvis.cognition.objective.created` | OPERATIONS | 1 |
| `jarvis.cognition.objective.transitioned` | OPERATIONS | 1 |
| `jarvis.cognition.output.validated` | OPERATIONS | 1 |
| `jarvis.cognition.proposal.created` | OPERATIONS | 1 |
| `jarvis.cognition.result.delivered` | OPERATIONS | 1 |
| `jarvis.cognition.run.completed` | OPERATIONS | 1 |
| `jarvis.cognition.run.rejected` | OPERATIONS | 1 |
| `jarvis.cognition.run.started` | OPERATIONS | 1 |
| `jarvis.infra.node.connected` | OPERATIONS | 1 |
| `jarvis.infra.node.degraded` | OPERATIONS | 1 |
| `jarvis.infra.node.disconnected` | OPERATIONS | 1 |
| `jarvis.infra.node.heartbeat` | OPERATIONS | 1 |
| `jarvis.infra.node.isolated` | OPERATIONS | 1 |
| `jarvis.infra.node.revoked` | OPERATIONS | 1 |
| `jarvis.kernel.context.compiled` | OPERATIONS | 1 |
| `jarvis.kernel.event.dead_lettered` | OPERATIONS | 1 |
| `jarvis.kernel.event.rejected` | OPERATIONS | 1 |
| `jarvis.kernel.health.transitioned` | OPERATIONS | 1 |
| `jarvis.kernel.identity.auth_failed` | SECURE | 1 |
| `jarvis.kernel.identity.authenticated` | SECURE | 1 |
| `jarvis.kernel.identity.revoked` | SECURE | 1 |
| `jarvis.kernel.lifecycle.degraded` | OPERATIONS | 1 |
| `jarvis.kernel.lifecycle.operational` | OPERATIONS | 1 |
| `jarvis.kernel.lifecycle.starting` | OPERATIONS | 1 |
| `jarvis.kernel.lifecycle.stopping` | OPERATIONS | 1 |
| `jarvis.kernel.mode.changed` | OPERATIONS | 1 |
| `jarvis.kernel.notification.raised` | OPERATIONS | 1 |
| `jarvis.kernel.presence.changed` | OPERATIONS | 1 |
| `jarvis.kernel.scheduler.tick` | OPERATIONS | 1 |
| `jarvis.kernel.session.ended` | OPERATIONS | 1 |
| `jarvis.kernel.session.started` | OPERATIONS | 1 |
| `jarvis.kernel.session.transitioned` | OPERATIONS | 1 |
| `jarvis.kernel.state.mutated` | OPERATIONS | 1 |
| `jarvis.kernel.state.snapshot_taken` | OPERATIONS | 1 |
| `jarvis.memory.candidate.disposed` | OPERATIONS | 1 |
| `jarvis.memory.candidate.scored` | OPERATIONS | 1 |
| `jarvis.memory.consolidation.completed` | OPERATIONS | 1 |
| `jarvis.memory.episode.recorded` | OPERATIONS | 1 |
| `jarvis.memory.insight.available` | OPERATIONS | 1 |
| `jarvis.memory.preference.recorded` | OPERATIONS | 1 |
| `jarvis.memory.procedure.updated` | OPERATIONS | 1 |
| `jarvis.memory.record.forgotten` | OPERATIONS | 1 |
| `jarvis.memory.semantic.learned` | OPERATIONS | 1 |
| `jarvis.perception.audio.activated` | EPHEMERAL | 1 |
| `jarvis.perception.audio.asr.partial` | EPHEMERAL | 1 |
| `jarvis.perception.audio.asr.transcript` | EPHEMERAL | 1 |
| `jarvis.perception.audio.barge_in` | EPHEMERAL | 1 |
| `jarvis.perception.audio.device_changed` | EPHEMERAL | 1 |
| `jarvis.perception.audio.lost` | EPHEMERAL | 1 |
| `jarvis.perception.audio.silence` | EPHEMERAL | 1 |
| `jarvis.perception.hands.air_touch` | EPHEMERAL | 1 |
| `jarvis.perception.screen.context` | EPHEMERAL | 1 |
| `jarvis.perception.vision.camera_lost` | EPHEMERAL | 1 |
| `jarvis.perception.vision.camera_restored` | EPHEMERAL | 1 |
| `jarvis.perception.vision.person_present` | EPHEMERAL | 1 |
| `jarvis.security.alert.critical` | SECURE | 1 |
| `jarvis.security.alert.elevated` | SECURE | 1 |
| `jarvis.security.alert.high` | SECURE | 1 |
| `jarvis.security.alert.low` | SECURE | 1 |
| `jarvis.security.credential.minted` | SECURE | 1 |
| `jarvis.security.guardian.cleared` | SECURE | 1 |
| `jarvis.security.guardian.entered` | SECURE | 1 |
| `jarvis.security.guardian.step_completed` | SECURE | 1 |
| `jarvis.world.causal.hypothesised` | OPERATIONS | 1 |
| `jarvis.world.conflict.recorded` | OPERATIONS | 1 |
| `jarvis.world.conflict.resolved` | OPERATIONS | 1 |
| `jarvis.world.entity.merged` | OPERATIONS | 1 |
| `jarvis.world.entity.upserted` | OPERATIONS | 1 |
| `jarvis.world.fact.asserted` | OPERATIONS | 1 |
| `jarvis.world.fact.expired` | OPERATIONS | 1 |
| `jarvis.world.fact.superseded` | OPERATIONS | 1 |
| `jarvis.world.observation.promoted` | OPERATIONS | 1 |
| `jarvis.world.observation.recorded` | OPERATIONS | 1 |
| `jarvis.world.record.forgotten` | OPERATIONS | 1 |
| `jarvis.world.relationship.asserted` | OPERATIONS | 1 |

---

## REAL NATS TEST EVIDENCE

The repository's `nats-jetstream.integration.test.ts` does start a real `nats:2.10-alpine` container — it is not a string-inspection test, and it carries no `skipIf`, so it cannot silently skip. `scripts/run-it.mjs` additionally hard-fails the whole gate when the Docker daemon is unavailable, so the integration suite cannot report a false green.

It was nevertheless insufficient: it exercises `NatsEventBus` **in isolation**, never the Kernel. `apps/core/test/it-harness.ts` builds every Kernel with `forceInProcessBus: true` and `natsEnabled: false`, so **no test in the repository had ever run the Kernel against JetStream.** That gap is now closed by two new suites (see *Fixes made*).

Evidence from [`rc11-event-fabric-audit.integration.test.ts`](../../apps/core/test/rc11-event-fabric-audit.integration.test.ts), against a live server:

- **All streams created.** `jsm.streams.list()` returned exactly `EPHEMERAL`, `OPERATIONS`, `SECURE`, with subject sets equal to the configured topology.
- **Bus reports healthy.** `transportHealth = [true]` — the health callback fired once, positively, on connect; no spurious disconnect.
- **Representative events publish and consume across all three classes** — `EPHEMERAL` (`audio.asr.transcript`, `hands.air_touch`), `SECURE` (`identity.revoked`, `security.alert.high`), `OPERATIONS` (`mode.changed`, `agency.invocation.started`). All six were delivered to a durable pull consumer.
- **Durable consumers with explicit ack.** One durable per stream (`<consumer>--EPHEMERAL` etc.), each with `ack_policy: explicit`. After delivery: `num_pending = 0`, `num_ack_pending = 0`, `num_redelivered = 0` on all three — messages were acknowledged, not merely received.
- **Dedupe is server-side.** Each of the six events was published **twice** with the same `msgID`. Stream message counts afterwards: `{"EPHEMERAL":2,"SECURE":2,"OPERATIONS":2}` — 12 publishes, 6 stored. The handler saw each event exactly once, re-checked after an additional settle window.
- **Reconnect.** Verified in `nats-jetstream.integration.test.ts` (container stopped → `isHealthy()` false and the health callback observed `false`; container restarted → `isHealthy()` true, callback's last value `true`, and a post-restart publish delivered exactly once), and again end-to-end through the Kernel in AUDIT 4 below.

`InProcessEventBus` was not used for any of this.

---

## DLQ RECURSION TEST EVIDENCE

**This is where the audit failed the entry commit.**

Codex's fix added `deadLetterNotificationEligible()`, which suppresses the `EventDeadLettered` notification when the dead-lettered event is *itself* an `EventDeadLettered`. That closes exactly one edge of the cycle. It is not the edge that was open.

### The real cycle

`OutboxRelay.drainOnce()` does three things when an outbox row exhausts its retries: writes a DLQ row, emits `EventDeadLettered`, and calls `onHealth('DEGRADED', ...)`. That third call is the leak:

1. `onHealth` heartbeats `event-fabric: DEGRADED` with the message `` `outbox dead-lettered ${event.id}` `` — **a different message for every dead-lettered event.**
2. `HealthManager.applyHeartbeat` short-circuited only when status *and* message were unchanged. A changed message therefore counted as a transition, and emitted a durable `HealthTransitioned` event.
3. That `HealthTransitioned` event went into the outbox, failed to publish (transport still down), exhausted its retries, and dead-lettered — emitting a fresh `EventDeadLettered` **and** another uniquely-messaged health heartbeat.
4. Go to 1.

`EventDeadLettered` was guarded; `HealthTransitioned` was not, and it was the event the dead-letter path generated itself. Every dead-lettering therefore produced at least one new durable event guaranteed to dead-letter in turn.

### Measured before the fix

Kernel on real Postgres + real NATS, NATS stopped permanently, **3** source events injected, then the relay driven in rounds of 40 passes (`T1`…`T5`) with the clock advanced past every backoff window:

| | `outbox` pending | `health.transitioned` | `event.dead_lettered` |
|---|---|---|---|
| T0 | 3 | 0 | 0 |
| T1 | 25 | 27 | 20 |
| T2 | 37 | 55 | 32 |
| T3 | 56 | 82 | 51 |
| T4 | 71 | 110 | 66 |
| T5 | 92 | 138 | 87 |

Monotonic, unbounded, and self-sustaining with no further input. The 12-event variant of the same experiment grew from 547 durable events to 1090 across one additional idle interval. **A permanent NATS outage grew the durable event log forever — the brief's explicit NO-GO condition.**

### Measured after the fix

Same experiment, N = 12 source failures, driven to quiescence (150 passes) and then driven 150 passes further:

```
DLQ_SETTLED = {"events":44,"outboxPending":0,"deadLetter":30,"deadLetteredEvents":14}
DLQ_STABLE  = {"events":44,"outboxPending":0,"deadLetter":30,"deadLetteredEvents":14}
DLQ_BY_TYPE = [ dead_lettered=14, health.transitioned=2, mode.changed=1,
                scheduler.tick=12, state.mutated=1 ]
```

`SETTLED` and `STABLE` are **identical** — a true fixed point, not slow growth. The outbox fully drains to zero: every durable record reaches a terminal state. For N = 12 source failures the system produced 14 `EventDeadLettered` records (the 12 sources plus the two bounded fabric self-observations: one health transition and one mode change) — **O(N) with a small constant**, verified by assertion at `≤ 2N + 8`.

### Direct recursion probe

Attempting to dead-letter an `EventDeadLettered` is not hypothetical here — it happens 14 times in the run above, because the notifications themselves cannot be published either. The audit asserts on the causation graph in Postgres:

```sql
select count(*) from events.events child
  join events.events parent on child.causation_id = parent.id
 where child.type = 'jarvis.kernel.event.dead_lettered'
   and parent.type = 'jarvis.kernel.event.dead_lettered'
```

**Result: 0.** No `EventDeadLettered` has an `EventDeadLettered` parent. No second generation exists.

The guard is now defence in depth, covering the whole class rather than one member: `EventDeadLettered`, `EventRejected` and `HealthTransitioned` are all recognised as event-fabric self-observations and can never trigger a further notification.

This evidence is from a real Kernel, real Postgres and real NATS. The pre-existing `outbox-relay.test.ts` recursion test used only hand-written mocks — which is why it passed throughout the period the defect was live.

---

## NATS OUTAGE / RECOVERY TEST

Full cycle from [`rc11-nats-outage-audit.integration.test.ts`](../../apps/core/test/rc11-nats-outage-audit.integration.test.ts), Kernel bound to a real NATS container:

| Step | Result |
|---|---|
| 1. Start healthy | Bus healthy, mode `AMBIENT` |
| 2. Stop NATS (`docker stop`) | `bus.isHealthy()` → false; `nats` subsystem → `OFFLINE`; overall health → `DEGRADED` |
| 3. Generate persistent events during the outage | 10 durable events written to `events.events` + `events.outbox` |
| 4. Degrade safely | `{"outboxPending":13,"deadLetter":0}` — nothing lost, nothing dead-lettered, everything durable in Postgres |
| 5. Restart NATS | Container restarted |
| 6. Reconnection | `bus.isHealthy()` → true; `nats` subsystem → `HEALTHY` via the transport callback |
| 7. Outbox drains | `outboxPending` → **0** |
| 8. No duplicates | `received = 10`, `unique = 10`; `deadLetter` remains **0** |
| 9. Event fabric healthy | `event-fabric` → `HEALTHY`, `criticalDepsHealthy()` → true |
| 10. Healthy mode | mode `AMBIENT` |

No event was lost, no event was delivered twice, and the outbox absorbed the entire outage. This is the first test in the repository to kill NATS underneath a *running Kernel* and observe recovery — `README.md` previously (and correctly) listed that as a gap.

---

## KERNEL HEALTH RECOVERY FINDING

### The DEGRADED → AMBIENT fix is a genuine root-cause fix

Commit `98b76be` was examined for the failure patterns the brief rejects. It exhibits none of them, and is in fact the opposite of several:

- **Not increased sleeps.** It *deleted* two `await new Promise(r => setTimeout(r, 20))` synchronisation hacks from `kernel-lifecycle.integration.test.ts`. The tests are now synchronous on the heartbeat promise.
- **Not retries masking failure.** No retry was added.
- **Not test weakening.** Four new lifecycle tests were added, including one that asserts the Kernel *stays* DEGRADED while a second critical dependency is unhealthy.
- **Not skipped assertions.** Assertions were strengthened (`expect(health.criticalDepsHealthy()).toBe(true)` replaced a sleep).
- **Not demoting a critical dependency.** `git log -L` confirms `nats: critical: false` dates from the initial commit and was untouched. What changed is the *mode reconciliation predicate*: it now keys off `criticalDepsHealthy()` rather than the `overall` roll-up, so a non-critical subsystem's outage no longer forces mode DEGRADED. That is architecturally coherent — `computeOverall` deliberately lets a non-critical failure nudge `overall` to DEGRADED, and mode should not inherit that.

The three real defects it fixed:

1. **A start-up race.** `health.onChange(...)` was registered but never reconciled against the health state that already existed, so the first heartbeats after start were not applied to mode. `await reconcileModeWithHealth(health.report().overall)` at the end of `start()` closes it.
2. **Silently swallowed listener errors.** `catch { /* ignore listener errors */ }` meant a failed mode transition looked like a successful heartbeat. Errors now propagate to the heartbeat caller.
3. **A re-entrant relay tick.** `running = false` was replaced with a shared `activeRun` promise, so `stop()` joins an in-flight pass instead of racing it.

**False AMBIENT recovery is guarded twice.** `reconcileModeWithHealth` only requests `AMBIENT` when `criticalDepsHealthy()` is true, and independently `transition-policy.ts` refuses to leave `DEGRADED` with `guard_health: 'cannot leave DEGRADED until critical dependencies are healthy'`. Verified end to end (AUDIT-4b): with `event-fabric` and `agency` both unhealthy, recovering only `event-fabric` leaves the Kernel in `DEGRADED`; it returns to `AMBIENT` only after `agency` also recovers.

### But it introduced a process-killing regression

Making listener errors propagate is right at the direct-caller boundary and wrong at the background-timer boundary, and no caller was adjusted. `OutboxRelay.schedule()` runs `setTimeout(() => void this.tick(), delay)`. A throwing health listener now escapes `tick()` as an **unhandled promise rejection**. Observed live during this audit:

```
Error: health-to-mode degradation failed: illegal_transition: slice row missing: mode
  ❯ reconcileModeWithHealth apps/core/src/kernel/lifecycle/kernel.ts:502:56
  ❯ HealthManager.applyHeartbeat apps/core/src/kernel/health/health-manager.ts:146:44
```

Every mode can legally reach `DEGRADED`, so this code is not reached through the transition policy — it is reached when `state.mutate` fails, i.e. a Postgres problem. A correlated Postgres + NATS failure is precisely the scenario in which the relay is tick­ing hardest, and under Node's default `--unhandled-rejections=throw` this terminates the Kernel.

The same removal put `NatsEventBus.watchConnection()` at risk: a throw from `onTransportHealth` would end the `for await (const status of nc.status())` iterator, after which the bus could never report `reconnect` again — one blip would leave the Kernel permanently convinced the transport was down.

Both are fixed below, without reverting Codex's intent: `HealthManager` still propagates to direct callers, but the two background loops now absorb, log and continue.

### One asymmetry reported, deliberately not changed

A NATS outage produces different mode outcomes depending on *when* it happens:

- **NATS already down at Kernel start** → `event-fabric` (critical) is heartbeat `DEGRADED` at line 614 → mode `DEGRADED`.
- **NATS drops while running** → only the `nats` subsystem (non-critical) is heartbeat, by both the transport callback and the `healthSelfCheck` routine. `event-fabric` stays `HEALTHY` until the relay actually dead-letters something. Overall health goes `DEGRADED`, but **mode stays `AMBIENT`** (measured: `{"natsHealth":"OFFLINE","overall":"DEGRADED","mode":"AMBIENT"}`).

Staying available is consistent with `FAILURE_MODEL.md` § *NATS offline* ("Kernel keeps writing PostgreSQL. Distribution pauses."), and the audit confirmed the outage is genuinely survived with no loss and no duplicates. It is not a false-AMBIENT-while-critical-unhealthy bug: no critical subsystem is unhealthy by the system's own definition. But the two paths disagree about the same physical condition, and the resolution — either heartbeat `event-fabric` from the transport callback, or stop heartbeating it at start-up — is a posture decision for the principal architect, not one an external auditor should make unilaterally. **Recorded as DEFECT-6, non-blocking.**

### Determinism

`kernel-lifecycle.integration.test.ts` (9 tests, including all four health-recovery tests) and both new audit suites were run repeatedly. Results are recorded in *CI result* below.

**A limitation of the audit host, stated plainly.** `JARVIS_IT_WORKERS=2` could not be validated on this machine. Docker Desktop here is allocated **3.1 GB** (`docker info` → `MemTotal: 3105402880`), and two parallel workers each holding an ephemeral `pgvector/pgvector:pg16` container plus a `nats:2.10-alpine` container exhausted it: the full suite took ~1200s per run (against ~45s on the GitHub runner), unrelated suites failed with `connect ECONNREFUSED` against their own Postgres, one run had six files self-skip because `isDockerAvailable()` began returning false mid-run, and a third run could not start at all — `docker ps` failed outright and the mandatory gate correctly refused to proceed.

Every failure observed under `WORKERS=2` was `container did not become ready` or a Postgres connection refusal. **Not one was an assertion failure**, and the pre-existing `nats-jetstream.integration.test.ts` failed the same way, so this is host capacity, not the code under audit. It is recorded here rather than omitted because "we ran it twice and it was fine" would have been the easier and less honest claim.

`JARVIS_IT_WORKERS=2` determinism is therefore evidenced by the GitHub-hosted workflow, which sets exactly that value — which is what the brief requires as the authority in any case. Two container-lifecycle robustness fixes made in response to this (Docker-assigned ports, 60s readiness windows with container logs on failure) reduce the same flake class in CI.

---

## CI RESULT

**GitHub Actions run [34365412730](https://github.com/TheFridey/Jarvis-Mk.42/actions/runs/34365412730) for `98b76be`: `success`.**

Every stage ran; none was skipped by an early failure. Verified per-step, not by trusting the job-level conclusion:

| # | Step | Result |
|---|---|---|
| 7 | `pnpm typecheck` | success |
| 8 | `pnpm lint` | success |
| 9 | `pnpm test` (unit) | success — 40 files |
| 10 | `pnpm test:integration` (`JARVIS_IT_WORKERS=2`) | success — 12 files |
| 11 | `pnpm test:contract` | success — 4 files |
| 12 | `pnpm test:security` | success — 3 files |
| 13 | `pnpm fitness` | success — 2 files |
| 14 | `pnpm test:chaos` | success — 2 files |
| 15 | `pnpm backup:drill` | success |
| 16 | `pnpm build:desktop` | success |

The integration step's log confirms the mandatory JetStream suite genuinely executed on the GitHub-hosted runner rather than self-skipping:

```
✓ |integration| apps/core/test/nats-jetstream.integration.test.ts (2 tests) 3879ms
  ✓ real NATS JetStream topology > reports disconnect, reconnects, and resumes
    unique delivery after NATS restarts 2093ms
```

For context, the two immediately preceding runs were red — `7f79bd1` (the JetStream/DLQ fix) and `b511427` (the run under which RC1 was certified GO). Only `98b76be` is green.

**Local verification of this audit's changes.** `pnpm verify:full` — the exact command sequence CI runs — exited 0:

| Gate | Result |
|---|---|
| `typecheck` | clean |
| `lint` | clean |
| `test` (unit) | 40 files / **196** tests passed |
| `test:integration` | 14 files / **75** tests passed, **0 skipped** |
| `test:contract` | 4 files / 16 passed |
| `test:security` | 3 files / 30 passed |
| `fitness` | 2 files / 17 passed |
| `test:chaos` | 2 files / 13 passed |
| `backup:drill` | passed |
| `build:desktop` | compiled |

Repeat runs for determinism — `rc11-nats-outage-audit`, `rc11-event-fabric-audit`, `nats-jetstream` and `kernel-lifecycle` together, three consecutive times: **17 / 17 passed on every run**, with `DLQ_SETTLED == DLQ_STABLE` and `outboxPending: 0` each time. Absolute totals vary between runs (44/30/14 vs 48/40/18 events/DLQ/notifications) because the Kernel's start-up backlog differs; the asserted bound is the delta against a post-quiescence baseline, which held throughout.

Two defects in the audit's *own* new tooling were found and fixed by these repeat runs, which is the argument for running a suite more than once:

- Switching to a Docker-assigned host port (`-p 127.0.0.1::4222`) was wrong for these suites specifically. Docker allocates an unspecified host port at **start** time, so a container restarted by a reconnection test can come back on a different port — leaving both the test's URL and the `NatsEventBus` reconnect target inside the Kernel under test pointing at nothing. The port must be explicit and stable; the collision risk that creates is now handled by retrying the run on a bind failure.
- A raw TCP readiness probe returns a false ready, because Docker's userland port proxy accepts connections before `nats-server` is listening inside the container. Readiness now waits for the `INFO` greeting nats-server sends on every accepted connection.

Both live in the new `packages/testkit/src/nats-container.ts` (`startEphemeralNats`), a sibling of `startEphemeralPg`, so all three JetStream suites share one implementation instead of three copies of the same hazard.

**Hosted CI for the audit commit `6655887`: run [34408708468](https://github.com/TheFridey/Jarvis-Mk.42/actions/runs/34408708468) — `success`.** All 16 steps ran; none skipped. Verified from the run log that both new suites genuinely executed on the GitHub runner rather than self-skipping:

```
✓ |integration| apps/core/test/rc11-nats-outage-audit.integration.test.ts (3 tests) 13694ms
✓ |integration| apps/core/test/rc11-event-fabric-audit.integration.test.ts (3 tests) 1413ms
✓ |integration| apps/core/test/nats-jetstream.integration.test.ts     (2 tests)  2891ms
  Test Files  14 passed (14)
```

This run is also the `JARVIS_IT_WORKERS=2` determinism evidence that the audit host could not produce: 14 integration files, zero skipped, at two workers.

---

## DEFECTS FOUND

| # | Severity | Defect | Status |
|---|---|---|---|
| 1 | **CRITICAL** | **Dead-letter recursion was not fixed.** The guard covered only `EventDeadLettered → EventDeadLettered`; the live cycle ran through `HealthTransitioned`, because the relay heartbeats a *unique message per dead-lettered event id* and `HealthManager` treated a changed message as a transition. A permanent NATS outage grew durable events without bound (3 source failures → 138 health events and 87 dead-letter notifications, still climbing). Codex's commit message claimed this was repaired. | **Fixed** |
| 2 | **HIGH** | Removing the health-listener `try/catch` (`98b76be`) turned a failed mode transition into an **unhandled promise rejection** escaping `setTimeout(() => void this.tick())` in `OutboxRelay`, killing the process under Node's default rejection policy. Observed live. | **Fixed** |
| 3 | **HIGH** | The same change could terminate `NatsEventBus.watchConnection()`'s status iterator, after which the bus could never report `reconnect` — one transport blip would permanently pin the Kernel to "transport down". | **Fixed** |
| 4 | MEDIUM | **No test ran the Kernel against real NATS.** `it-harness.ts` forces `forceInProcessBus: true`, and the real-NATS suite covers only the bus in isolation. The entire Kernel↔JetStream↔outbox recovery path was untested, which is why defects 1–3 survived a green suite. | **Fixed** |
| 5 | LOW | `scripts/run-it.mjs` swept leaked ephemeral containers matching only `jarvis-it-pg-`. The JetStream suites create `jarvis-it-nats-*` containers, which leaked — the exact failure mode the script's own comment warns degrades the Docker daemon for later runs. | **Fixed** |
| 5b | MEDIUM | **Racy host-port allocation in every JetStream suite.** The suites chose a free port in-process (`server.listen(0)`, close, then `docker run -p 127.0.0.1:<port>:4222`). Between closing the probe socket and Docker binding, Docker can assign that port to another container — under `JARVIS_IT_WORKERS=2` this collided with a parallel worker's ephemeral Postgres and surfaced as `connect ECONNREFUSED` failures in unrelated suites (ATLAS/MNEMOSYNE). Reproduced live during the determinism runs. `startEphemeralPg` had already solved this correctly; the NATS suites had not. | **Fixed** |
| 6 | LOW | Start-up and run-time NATS outages produce different modes for the same physical condition (`DEGRADED` vs `AMBIENT`). Consistent with `FAILURE_MODEL.md` and safe, but internally inconsistent. | **Reported, not changed** — posture decision for the principal architect |
| 7 | DOC | `README.md` claimed gates were "all green in CI on every push to `main`" while the two most recent runs (`b511427`, `7f79bd1`) were red, and `MK42_RELEASE_CANDIDATE_AUDIT.md` certified RC1 GO on a commit whose CI run failed. | **Fixed** (README corrected) |

Checks that found **nothing**: no comment or test claims consumer filters resolve stream overlap; no test using the in-process bus calls itself a JetStream test; the mandatory NATS test carries no `skipIf` and the integration gate hard-fails without Docker; the health tests contain no arbitrary sleeps (Codex removed the two that existed); no swallowed health-listener errors remain.

---

## FIXES MADE

All by this audit, on top of `98b76be`.

**`apps/core/src/kernel/health/health-manager.ts`** — a same-status heartbeat no longer emits `jarvis.kernel.health.transitioned`. The event now means what its name says. This is the root-cause fix for DEFECT-1: it removes the unbounded durable-event source at the point where it is created, rather than adding another suppression rule downstream.

Listeners still run on *every* heartbeat, including same-status ones. This distinction matters and was found by regression: an earlier form of this fix also skipped the listeners, which broke recovery after a dwell-blocked transition — a heartbeat refused by hysteresis would never get a second chance, leaving the Kernel stuck in `DEGRADED` until the status happened to flap. Listeners are in-memory and emit nothing unless the mode actually changes, so running them always is bounded (a rejected `requestTransition` writes nothing), while skipping them is not safe.

**`apps/core/src/kernel/event-fabric/outbox-relay.ts`** — three changes:
- `deadLetterNotificationEligible` now suppresses the notification for the whole class of event-fabric self-observations (`EventDeadLettered`, `EventRejected`, `HealthTransitioned`), so the cycle stays closed even if health emission becomes chatty again.
- The dead-letter health message is no longer per-event-id (`'outbox dead-lettering: transport unavailable'`), removing the unique-message pressure at source.
- All `onHealth` calls go through `reportHealth()`, which logs a throwing listener instead of letting it escape the `setTimeout`-driven tick as an unhandled rejection (DEFECT-2).

**`apps/core/src/kernel/event-fabric/nats-bus.ts`** — `watchConnection()` routes the health callback through `reportTransport()` and wraps the status loop, so a throwing listener can no longer end the iterator and disable reconnect reporting (DEFECT-3).

**`packages/testkit/src/nats-container.ts`** *(new)* — `startEphemeralNats()`, the JetStream sibling of `startEphemeralPg()`. It keeps an explicit, stable host port (required for the stop/start reconnection tests) and handles the collision risk that creates by retrying `docker run` on a bind failure rather than failing the suite, and its readiness probe waits for nats-server's `INFO` greeting rather than a bare TCP accept. `nats-jetstream.integration.test.ts` and both new audit suites now use it, and the three copies of the racy `freePort()` helper are gone. This is the fix for DEFECT-5b.

**`scripts/run-it.mjs`** — the leaked-container sweep now covers `jarvis-it-pg-`, `jarvis-it-nats-` and `jarvis-audit-` (DEFECT-5).

**`apps/core/test/rc11-event-fabric-audit.integration.test.ts`** *(new)* — the topology proof. Reads stream configuration back from the live server and re-derives ownership with an independent NATS matcher, so `stream-topology.ts` cannot validate itself; asserts exactly-one-owner for all 109 events, zero wildcards, zero orphan subjects; asks the server to reject a `jarvis.>` catch-all; and proves delivery, explicit ack and server-side dedupe across all three streams.

**`apps/core/test/rc11-nats-outage-audit.integration.test.ts`** *(new)* — the Kernel-over-real-NATS suite: the bounded-DLQ fixed-point proof with the SQL causation-graph recursion probe, the full outage → degrade → restart → drain → no-duplicates cycle, and the no-false-AMBIENT check. Closes DEFECT-4.

**`apps/core/src/kernel/health/health-manager.test.ts`**, **`outbox-relay.test.ts`** — unit regressions pinning both invariants cheaply: a same-status heartbeat emits nothing but still notifies listeners, a real status change still emits, and every fabric self-observation is ineligible for a dead-letter notification.

**`README.md`** — status corrected to RC1.1; the "chaos gate never kills NATS under a running Kernel" gap is narrowed to reflect the new coverage; the "all green in CI" claim is stated against the specific green run rather than as a general property.

---

## VERDICT

The entry commit `98b76be` would have been **NO-GO**: the dead-letter recursion the commit before it claimed to repair was still live, and a permanent NATS outage grew the durable event log without bound — the brief's stated NO-GO condition — while a second defect introduced by the health-lifecycle commit could terminate the Kernel process outright. Neither was visible to the existing suite, because nothing in the repository had ever run the Kernel against a real transport.

Those defects are now fixed at the root, and the fixes are proven against real infrastructure rather than mocks: the topology is exactly-one-owner for all 109 canonical events as read back from a live server; a 12-failure outage reaches an identical fixed point across two further idle intervals with the outbox fully drained; no `EventDeadLettered` has an `EventDeadLettered` ancestor; and a full stop/restart cycle under a running Kernel loses nothing and duplicates nothing.

**RC1.1 EVENT FABRIC — GO**

The condition is met: hosted CI run 34408708468 for the audit commit is green across all sixteen steps, with both new real-NATS suites executing on the runner at `JARVIS_IT_WORKERS=2`.

Carried forward, unresolved and explicitly not covered by this GO:

- **DEFECT-6** — the start-up/run-time degradation asymmetry needs a posture decision.
- The audit covered the **event fabric only**. Nothing here revalidates cognition, agency, voice, vision, or the hardware capability gaps that `MK42_RELEASE_CANDIDATE_AUDIT.md` listed as unproven.
