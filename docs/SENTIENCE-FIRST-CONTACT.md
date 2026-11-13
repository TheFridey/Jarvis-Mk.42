# SENTIENCE · First Contact

Status: **partially achieved, and the part that was not achieved is blocked by
authorisation and configuration, not by code.** A real Kernel was started, a real
Operating Picture reached the interface, and the interface showed it truthfully.
No model was called, no microphone was opened, and no paid provider was touched.

Baseline: `feature/sentience-genesis` at `8d7f9f5`. Original Mark 42 untouched at
`9c1b880`. Containers were started from the repository's own compose file; no
production infrastructure was contacted.

## Completion classifications

| Workstream | Classification | What that means here |
|---|---|---|
| VISUAL_REFINEMENT | **VERIFIED_LIVE** | Rendered by this machine's GPU against a live Kernel, captured. |
| HARDWARE_RENDERING | **VERIFIED_LIVE** | Unmasked Adreno X1-45 via ANGLE/D3D11, measured, not inferred. |
| KERNEL_CONNECTION | **VERIFIED_LIVE** | Kernel + Postgres + Redis + NATS running; authenticated snapshot delivered; states matched. |
| MODEL_INFERENCE | **BLOCKED_EXTERNAL** | Model Gateway is `OFFLINE`; no provider credentials configured; paid calls unauthorised. |
| PHYSICAL_MICROPHONE | **BLOCKED_EXTERNAL** | RTC reports `OFFLINE`; no LiveKit credentials for the Jarvis session. |
| VOICE_RESPONSE | **NOT_ATTEMPTED** | Depends on the two above. |
| FULL_CONVERSATIONAL_LOOP | **NOT_ATTEMPTED** | Depends on the three above. **First Contact is not complete.** |

## A — Independent self-review of the Genesis/Awakening work

Four real defects were found. Two were mine, two were inherited and amplified.

**1. A historical failure held the whole experience in FAULT.** The live Kernel
reported `workState: 'ERROR'` while health was `HEALTHY` and nothing was running,
because one invocation had failed earlier and the projection keeps terminal rows.
Presence mapped that to FAULT on an idle system — the opposite of truthful.
`resolveExperiencePhase` now treats a work fault as current only while its
evidence is recent (`FAILURE_EVIDENCE_WINDOW_MS`, 5 min); otherwise it evaluates
the remaining axes. The Kernel axis is still trusted when the projection carries
no ledger at all. With the live Kernel this changed the displayed state from
FAULT to `STANDBY` whose detail reads *"Standing by. Last work fault:
clients.read · VERIFICATION_FAILED at 21:07."* The failure is named, not relived.

**2. An old success could become permanent VERIFIED.** `verifiedEvidence`
accepted any historical successful invocation. It now requires the entry's
`updatedAt` inside a 10-minute window; if the entry cannot be dated, completion is
not claimed at all. A later failure still supersedes an earlier success, and an
active invocation still blocks completion.

**3. The detail line could collide with the input.** Only found by measuring the
live interface: a long fault sentence wraps to two lines, and the zone budget had
one line reserved. The band is now two lines (74px), the line is clamped to two
with the full sentence in `aria-label`, and the geometry guarantee holds again.

**4. Mounting the presence GPU layers only when present made re-entry cost 137ms.**
Already fixed in Awakening (they stay mounted, invisible), and re-verified live:
33.6ms warm.

Reviewed and found sound: stale TTS (>3s) cannot imply speech; `RESPONDING`
without audio shows RESPONDING rather than SPEAKING; disconnected and synthetic
states disable input and voice; approvals stay visible and inert when
disconnected; hidden GPU layers are `visible=false` (no draw call, no fragment
cost) yet keep their programs compiled; the RTC hook has one lifecycle for both
surfaces and releases tracks on stop, disconnect and unmount; disabled styles are
opacity-based and never rely on `!important` chains.

Seven adversarial tests were added (5 phase-policy, 3 presence-policy, net +7 with
one rewritten): recent vs historical failure, no-ledger trust, historical failure
under live work, most-recent-fault selection, stale success, undateable success.

## B — Infrastructure readiness (read-only first, then started)

| Item | State found | Note |
|---|---|---|
| Docker engine | **running**, 29.9.3 | Works today; the earlier "WSL engine failure" no longer reproduces. |
| WSL | Ubuntu **stopped**, docker-desktop running | Not repaired, not reconfigured. |
| Postgres (Jarvis) | started from compose, **healthy** on `5433` | Native `postgres` also listens on 5432; that is a different service. |
| Redis | **healthy** on `6380` | |
| NATS JetStream | **healthy** on `4222`/`8222` | |
| LiveKit | already running on `7880/7881` from `rtc.compose.yml` | No Jarvis credentials configured, so the Kernel still reports `rtc OFFLINE`. |
| Model Gateway | **not running** | Requires provider configuration. |
| Migrations | applied `0018_domains.sql` | Database was already at 0017. |
| Config secrets | none read, none printed | No `.env` exists in the worktree; dev defaults were used. |

**Blocker found and worked around, worth recording:** the Kernel's default
`postgres://…@localhost:5433` times out on this host because `localhost` resolves
to `::1` first and Docker's published socket does not answer there in time. Passing
`127.0.0.1` explicitly fixes it:

```bash
JARVIS_DB_URL="postgres://jarvis:jarvis@127.0.0.1:5433/jarvis" \
JARVIS_REDIS_URL="redis://127.0.0.1:6380" \
JARVIS_NATS_URL="nats://127.0.0.1:4222" \
node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs" --filter @jarvis/core start
```

**Second finding, environmental:** the Postgres container spent ~9 minutes in a
checkpoint (`write=431s, sync=110s, total=544s`). During that window the Kernel's
experience projector logged `projection.failed` in a loop and diagnostics requests
stopped completing; the empty `deadLettered: 1041` counter and `ok: false` were
symptoms, not causes. After the checkpoint finished, the same process served
snapshots normally. This is host I/O contention, not an application defect — but
it means "the Kernel is slow" can look exactly like "the Kernel is broken", and the
UI must (and does) show CONNECTING rather than DISCONNECTED while it waits.

## C — Real Kernel connection

Started: postgres, redis, nats (compose), then `@jarvis/core` on the host.
Health at the time of capture (`/diagnostics`):

```
postgres HEALTHY · redis HEALTHY · event-bus HEALTHY · nats HEALTHY
world-model HEALTHY · memory-subsystem HEALTHY
model-gateway OFFLINE · rtc OFFLINE        overall HEALTHY     mode AMBIENT
```

The interface authenticated through the documented development path
(`POST /auth/session` with scopes `desktop.read/write`, `experience.read`, then
`GET /desktop/snapshot`), received a real Operating Picture, and rendered:

- **Connected:** word `STANDBY`, link `REALTIME LIVE`, detail naming the last work
  fault with its time, and a response surface containing a **real** ScaleSmiths
  situation payload pushed by the Kernel through a capability read.
- **Disconnected:** the same build with the Kernel stopped shows `DISCONNECTED`,
  no invented activity, input and microphone disabled, and the explicit
  `OPEN COMMAND CENTRE · RECONNECT` affordance.
- **Slow bootstrap:** shows `CONNECTING` / "No authoritative state is being shown",
  which is accurate and is *not* the same state as disconnected.

Evidence: `docs/evidence/sentience-first-contact/live-connected-standby.png`,
`live-disconnected.png`, and the two `qualification-live-*.json` records.

What this proves: transport, authentication, projection decoding, state mapping and
honest presentation all work against the real Kernel. What it does not prove: any
inference, any approval, any capability execution.

## D — Real model inference: blocked, with the exact procedure

The Model Gateway is a separate service (`apps/gateway`, port 7430) and is not
running. It reads `OPENROUTER_API_KEY` / `JARVIS_OPENROUTER_MODEL` from the
environment; the Kernel gates cloud models behind `JARVIS_MODEL_CLOUD_ALLOWED`
(default `false`). **No key was read, copied or requested, and no paid request was
made.**

Operator procedure for a single, bounded, authorised smoke test:

```bash
# 1. Start the gateway with your own key already exported in this shell only.
#    (Never commit it; never paste it into a transcript.)
export OPENROUTER_API_KEY=...            # your key, your shell
export JARVIS_OPENROUTER_MODEL=<exact model id you authorise>
node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs" --filter @jarvis/gateway dev

# 2. Restart the Kernel with cloud models allowed for this session only.
JARVIS_MODEL_CLOUD_ALLOWED=1 JARVIS_DB_URL="postgres://jarvis:jarvis@127.0.0.1:5433/jarvis" \
node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs" --filter @jarvis/core start

# 3. One request, no tools, bounded output (this is the only paid call).
#    Use the desktop command line, or POST /desktop/cognition with a single-line
#    input, an explicit preferredModel, and no attachments.
```

Expected observable sequence: input → phase THINKING → ROUTING → MODEL_ACTIVE →
response rendered in the presence answer surface → detail shows the routing
decision. Budget: one request, small `max_tokens`, timeout at the gateway's
default. Nothing here weakens the existing billing or provider protections, and
Jarvis V2's paid gate is untouched.

## E — Voice qualification: blocked at the RTC service

`rtc` reports `OFFLINE` because the Kernel has no LiveKit key/secret configured for
a Jarvis session (`JARVIS_LIVEKIT_API_KEY`/`_API_SECRET`/`JARVIS_LIVEKIT_URL`).
The LiveKit container that is running belongs to the earlier `rtc.compose.yml`
project and has no matching credentials.

What is already implemented and unit-tested (not hardware-verified):

- explicit activation only; `getUserMedia` runs inside the gesture;
- permission failure is reported, not retried silently;
- session admission, publish, and audio attach are one lifecycle with cancellation
  at every await boundary;
- teardown on stop, disconnect, unmount and mode switch;
- device loss surfaces as `MIC DEGRADED` from the Kernel's own device state;
- the orb reacts only to the Kernel's observed `voiceAudio`, never to invented
  amplitude;
- no cloud speech option is offered in presence.

Operator procedure once credentials exist:

1. Export the three LiveKit variables and restart the Kernel; `rtc` must read
   `HEALTHY` in `/diagnostics`.
2. Open presence, press the microphone control, accept the browser prompt.
3. Confirm `MIC LIVE`, then speak: the orb's envelope should move and the word
   should move to LISTENING → THINKING.
4. Stop the microphone; confirm the browser's recording indicator disappears and
   the state returns to STANDBY.
5. Record the session start/stop times and the observed states; without step 4
   passing, the session is not qualified.

Speech-recognition accuracy, playback and the full conversational loop remain
unqualified and are explicitly **not** claimed.

## F — Visual refinement

The owner's rejections were addressed at the geometry and material level, not by
tinting:

| Rejected | Change |
|---|---|
| Solid translucent amber bubble | The continuous surface is now a **rim-only torn haze** (`pow(1-facing, 3.4)`, noise-broken alpha). No filled shell exists. |
| Visible polygonal silhouette | The boundary is a **particle shell**: 6.8k–14k points on a jittered sphere, dimming at grazing angles. Silhouette comes from density, so no facets. |
| Rigid wireframe nucleus | The `EdgesGeometry` cage is gone. A diffuse additive core plus a small breathing warm point remain. |
| Filaments like planetary orbits | Torus knots replaced by **Bézier ribbons** whose control points drift on slow independent paths with travelling pulses — currents, not rings. |
| Dim response/approval panels | Both surfaces are effectively opaque in presence (97%), body copy promoted to platinum, borders and headers strengthened, approve/deny contrast raised. |
| Insignificant satellites | Orb size 14→19px, brighter halos, larger platinum labels with shadow, working satellites get a breathing ring. |
| Misleading demo input copy | Synthetic sessions now say **"Demo mode · synthetic data · commands disabled"**; the reconnect wording is reserved for a real disconnect. |

Radial luminance through the orb centre (0–260px, 0–255):

| | centre | mid | rim |
|---|---|---|---|
| Awakening (filled shell) | 127 | 47 | 21 |
| First Contact (particle boundary) | 79 | 22 | 10 |

The body is deliberately softer: the boundary is light, not a surface. `max`
luminance still comes from the nucleus, and the panels no longer depend on it.

## G — Performance regression

Same tool, same machine, same conditions; previous numbers are the Awakening
observations, not guarantees.

| Case | FPS | p95 | Frames >33ms | Heap | Presence switch (warm) |
|---|---|---|---|---|---|
| STANDBY (live Kernel) | 59–60 | 16.8 | 0–1 | 16.6 MiB | 33.6 ms |
| DISCONNECTED (Kernel stopped) | 60 | 16.7 | 0 | — | — |
| APPROVAL (fixture) | 54.7 | 16.8 | 1 | — | — |
| EXECUTING (fixture) | 53.9 | 16.8 | 2 | — | — |
| Reduced motion (live) | 16.66 ms mean | — | — | — | — |
| Mobile 390×844 (layout audit) | not measured | | | | |

Awakening baselines for comparison: STANDBY 60.0 / APPROVAL 55.1 / EXECUTING 54.9,
p95 16.7–16.8 ms, warm switch 33 ms, heap 12.2–14.6 MiB. The live Kernel adds
`+2–4 MiB` of heap (real projection + stream) and costs nothing measurable in
frame pacing. No regression attributable to the visual changes was observed; the
particle shell is drawn from the same tiers as before.

**One regression was found and closed during this pass.** The first build of the
particle boundary used 12,000 shell points at HIGH with larger sprites; EXECUTING
fell to **46.1 FPS with six frames over 33 ms**. Reverting the shell to the same
budget the Awakening composition used (9,000 points at HIGH, smaller sprites)
restored **53.9 FPS / two slow frames**, within run-to-run noise of the 54.9
baseline. The visual change is carried by material and density, not by particle
count, so this cost close to nothing.

Mobile performance was **not** measured (the qualifier drives a fixed viewport);
only layout was audited at 390×844.

## H — Engineering bridge, reviewed against reality

Three preconditions became concrete (recorded as §14 of
[`architecture/ENGINEERING-CONTRACT-V1.md`](architecture/ENGINEERING-CONTRACT-V1.md)):

1. **Never infer lifecycle from aggregate axes.** `workState` lies in both
   directions — it never says COMPLETE, and it says ERROR for history. Any bridge
   must read the ledger with timestamps.
2. **Scoped sessions, not the bootstrap credential.** The engineering capability
   needs its own scoped session bound to the requesting principal.
3. **Report gateway/RTC absence; do not retry it.** An engineering bridge that
   silently waits for a provider will look hung; it must fail closed and say why.

Nothing in the contract needed weakening. V2 is untouched.

## Verification

Evidence in `docs/evidence/sentience-first-contact/`:

| File | Content |
|---|---|
| `live-connected-standby.png` | Real GPU render, live Kernel, `STANDBY`, real ScaleSmiths payload in the response surface. |
| `live-disconnected.png` | Same build with the Kernel stopped: `DISCONNECTED`, no invented activity. |
| `gpu-approval-fixture.png`, `gpu-executing-fixture.png` | Real GPU renders of the approval and executing compositions (fixture content, labelled by the app). |
| `qualification-live-connected.json`, `qualification-live-disconnected.json` | Measurement records for the live cases. |
| `qualification-fixture-approval.json`, `qualification-fixture-executing.json` | Measurement records for the fixture cases. |
| `layout-audit-live-1856x890.json` | Every rect, overlap and focus measurement taken against the live Kernel. |

| Command | Result |
|---|---|
| `tsc -p apps/desktop/tsconfig.json --noEmit` | pass |
| `vitest run apps/desktop/src` | **166 tests** pass (9 new) |
| `pnpm lint` | `lint: clean` |
| `node scripts/run-gate.mjs fitness` | **17/17** pass |
| `pnpm build:desktop` (live export) | pass |
| `NEXT_PUBLIC_JARVIS_DEMO_MODE=1 pnpm build:desktop` | pass |
| `node scripts/inspect-presence.mjs` | no overlap / overflow / clipping |
| `node scripts/qualify-presence.mjs` (live + fixture) | records committed |
| Docker-dependent repo suites | **not run** — they expect the full stack including model-gateway |

## Limitations

1. No model call, no microphone capture, no conversational loop: the three
   remaining blockers are credentials and authorisation, not code.
2. The environment was left with containers running (postgres/redis/nats) and a
   Kernel process started by this session; both are local development resources.
3. Postgres checkpoint I/O on this workstation is severe enough to stall the
   projector for minutes; that will look like instability to an operator.
4. Mobile *performance* is unmeasured; mobile layout is audited.
5. `workState: 'ERROR'` remains a lossy axis upstream. The presentation compensates;
   the Kernel still reports it.

## The exact next operator action

1. Export `OPENROUTER_API_KEY` and `JARVIS_OPENROUTER_MODEL` in your own shell,
   start `@jarvis/gateway`, restart the Kernel with `JARVIS_MODEL_CLOUD_ALLOWED=1`,
   and issue **one** short request from the presence input. That single action
   moves MODEL_INFERENCE from BLOCKED_EXTERNAL to VERIFIED_LIVE.
2. Export the three `JARVIS_LIVEKIT_*` variables, restart the Kernel, confirm
   `rtc HEALTHY`, then press the microphone in presence and stop it again. That
   moves PHYSICAL_MICROPHONE to VERIFIED_LIVE.
3. Only then is the conversational loop testable — and only then should anyone
   call First Contact complete.
