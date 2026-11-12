# SENTIENCE · Awakening

Status: **IMPLEMENTED, MEASURED ON THIS MACHINE'S GPU, LAYOUT-AUDITED IN A REAL
BROWSER.** Not hardware-qualified on a second machine, and not a claim that the
assistant is production-ready.

Continues `feature/sentience-genesis` from `8246924`. This phase is corrections and
capability, not another architecture pass.

## What the owner asked for, and what changed

| Feedback | Change |
|---|---|
| The orb reads as a spherical galaxy, not an intelligence | New `cosmos/living-core.tsx`: a displaced continuous shell around the same particle field, with veins, a warm band, three internal filament knots and a restrained nucleus. |
| Standby screenshot shows overlapping status and response text | One deterministic vertical stack (`presenceZones`). The response now has its own column on wide screens and a bounded, scrolling surface on narrow ones; overlap is measured as zero across 16 viewport/scenario cases. |
| Interface text and controls excessively dim or small | Contrast and size pass over every presence surface: word 24px at 82% semantic colour, detail 14px at 72% ink, satellites 10.5px, footer 10.5px, borders raised from 10% to 16%, input placeholder no longer near-invisible. Dimness is now decoration-only. |
| Satellites should feel like entities, not labelled dots | Satellites are small luminous spheres with a halo, state-dependent colour, child sizing, and the label carried beside them. Identity, terminal removal and animation gating are unchanged and still genuine-only. |
| Presence needs integrated voice | `PresenceMic` composes the *same* trusted session hook as the command centre (`useRtcSession`, extracted from `RtcControl`). Explicit gesture, permission inside the gesture, local speech engine only, release on stop/disconnect/unmount. |
| Need genuine operational evidence | `scripts/qualify-presence.mjs` measures the real browser over CDP; it reported hardware acceleration on this workstation and the numbers below. `scripts/inspect-presence.mjs` audits real layout geometry. |

## Workstream A — visual corrections

Defects found by measurement, not by opinion:

1. **The docked response panel was positioned 350px left of its column.** A
   `position: fixed` child of a `transform: translateX(-50%)` stack resolves
   against the stack, not the viewport. The stack is now centred with
   `left: 0; right: 0; margin: auto`.
2. **The response was crushed to 5px** because its maximum height was applied to
   the body while the panel's header and padding were not accounted for. The cap
   now applies to the panel, and the body scrolls inside it.
3. **At 1024×768 the readout sat below the input** because the orb was sized for
   the wide layout while the response column did not exist. The composition now
   uses the same 1100px breakpoint as the column, and reserves a 140px reading
   surface in the stacked layout.
4. **The approval barrier covered the state word** when centred; it docks right on
   wide screens and becomes a bottom sheet below 1100px, where the decision
   deliberately takes the screen.
5. **Satellite labels could leave the viewport** and land on the input. Satellites
   now occupy the upper arc only, with a radius clamped to the frame.
6. **Focus was invisible on some controls.** Every interactive presence surface
   now has a 2px `--presence` outline on `:focus-visible`; `prefers-contrast: more`
   promotes body copy to full ink.

Audited with `node scripts/inspect-presence.mjs`:

```
1856x890  ambient       state=STANDBY      word="STANDBY"      satellites=0 overlaps=0 overflow=0
1856x890  approval      state=APPROVAL     word="AWAITING YOU" satellites=1 overlaps=0 overflow=0
1856x890  executing     state=EXECUTING    word="EXECUTING"    satellites=2 overlaps=0 overflow=0
1856x890  disconnected  state=DISCONNECTED word="STALE"        satellites=2 overlaps=0 overflow=0
1280x720  … 1024x768 … 390x844 …                        all overlaps=0 overflow=0
no overlap, overflow or clipping detected
```

The audit also injects a 24× long answer and confirms it stays inside its zone
(`longAnswerCrossesInput=false`) and scrolls rather than clipping.

## Workstream B — the living core

`cosmos/living-core.tsx` is the only new renderer component. It composes the
existing primitives and one vertex-displaced shell:

- **Body**: an `IcosahedronGeometry` whose radius is displaced by two octaves of
  the shared `NOISE` fbm plus a slow ridge term, so the silhouette is organic at
  the frame level and never a perfect sphere.
- **Interior**: fragment-side veins and a warm band that turns with the body, so
  the surface reads as matter rather than a shell; the alpha is `facing`-weighted,
  which is what removed the hollow-bubble look of the first attempt.
- **Filaments**: two to three `TorusKnotGeometry` strands with travelling pulses,
  dim threads between them.
- **Nucleus**: a small icosahedron plus an edge cage and a soft inner sphere.
- **Cost**: three geometries, no textures, no new post-processing; segment counts
  and strand count come from the existing quality tiers; every value is damped on
  the shared clock and skipped under reduced motion.

Measured effect on the composition, as radial luminance from the orb centre
(0–180px band, 0–255):

| | centre | mid | rim |
|---|---|---|---|
| Genesis particle-only | 30 | 20 | 12 |
| Awakening, first attempt | 188 (hot nucleus) | 21 | 33 (bubble rim) |
| Awakening, final | 127 | 47 | 21 (soft body) |

Particles remain; the shell is the body around them. The command centre keeps its
existing appearance: the presence layers are mounted but invisible there.

## Workstream C — satellite intelligences

Unchanged in contract, upgraded in presentation: a radial-gradient sphere with a
halo, a second ring for working satellites that breathes, smaller spheres for
children observed through `parentJobId`, and `· CHILD` in the accessible label.
Terminal jobs still leave immediately; nothing animates without a current
observation and a confirmed lease; reduced motion stops the breathing.

## Workstream D — voice

Feasible and delivered, with the existing boundaries intact:

- `useRtcSession` is now the single lifecycle for both the command deck and
  presence. Behaviour is byte-for-byte the previous logic, moved, not rewritten.
- `PresenceMic` offers start/stop, shows `MIC LIVE` only when the session is
  actually live, reports degraded device state from the Kernel's own
  `voiceAudio.deviceState`, and surfaces the existing error text.
- Speech mode is fixed to the local engine in presence. Cloud routing remains an
  explicit command-centre choice; nothing in presence can select it.
- No amplitude is invented: the GPU envelope still consumes only the Kernel's
  observed `voiceAudio`.

Not verified: a physical microphone session. The Kernel is not running in this
worktree, so the RTC service is unavailable and the control correctly renders
`VOICE UNAVAILABLE`. That is the honest state, not a pass.

## Workstream E — contextual surface

The response is a reading surface, not a toast: header with `EXPAND`/`COLLAPSE`
and dismiss, scrollable body, `Escape` to collapse then dismiss, `aria-live`
region, and conversation continuity preserved through the existing
`conversationId` path. It is docked left on wide screens so it never obstructs the
orb or the word, and bounded above the input when stacked.

## Workstream F — hardware qualification

`scripts/qualify-presence.mjs` serves the export, launches **system Chrome with
GPU acceleration untouched**, drives it over CDP and records what the machine
actually did. It refuses to call a software renderer hardware-qualified.

Measured on this workstation (`BOOK-HBHGH59PTH`, Windows 11 ARM64):

```
renderer        ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-45 GPU, Direct3D11)
hardware        true (unmasked renderer string)
idle fps        60.0      p95 16.7 ms    frames > 33 ms: 0     heap 14.6 MiB
approval state  55.1 fps  p95 16.8 ms    frames > 33 ms: 1     heap 12.2 MiB
executing state 54.9 fps  p95 16.8 ms    frames > 33 ms: 1     heap 14.4 MiB
switch to command centre  33 ms warm (first 66–85 ms)
switch to presence        33 ms warm (first 217–233 ms, DOM mount)
keystroke → painted frame 15.9–16.6 ms
reduced motion idle       16.67 ms mean (~60 fps, motion suppressed)
```

Two findings worth keeping:

1. **Presence used to cost 137 ms to re-enter.** The presence GPU layers now stay
   mounted across modes (invisible in the command centre), which removed the
   shader-compile stall: 137 ms → 33 ms warm.
2. **The first presence entry still costs ~230 ms** because the DOM subtree mounts.
   Documented, not hidden; pre-warming it would trade memory for latency.

Operator procedure and the full metric list are in
[`architecture/SENTIENCE-QUALIFICATION.md`](architecture/SENTIENCE-QUALIFICATION.md).

## Workstream G — state semantics

Inspected against the canonical projection before changing anything:

1. **`workState` never carries `COMPLETE`.** `desktop-gateway.workState()`
   returns only VERIFYING/EXECUTING/WAITING/ERROR/BLOCKED/ROUTING/THINKING/IDLE,
   so `COMPLETE → VERIFIED` was effectively dead and "verified" had no live path.
   VERIFIED now also derives from the authoritative invocation ledger
   (`capabilityActivity`): a successful terminal state with no active invocation
   and no later failure. An earlier `EXECUTING` row of the same action is history,
   not activity; a failure after a success supersedes it. Four tests cover this.
2. **RESPONDING implied audible speech.** It no longer does: the state still
   expresses "responding", but the word is `RESPONDING` unless a TTS playback
   observation exists, in which case it is `SPEAKING`.
3. **Stale TTS could imply speech indefinitely.** `voiceAudio` now requires
   `tts === 'playing'` *and* an `observedAt` within 3 s. A flag with no timestamp
   establishes nothing.
4. **DEGRADED was silently presented as healthy standby.** The state stays
   STANDBY (the system is up), but the word becomes `DEGRADED`, the tone becomes
   attention, and the detail line says availability is reduced.
5. **Disconnected/synthetic cannot act.** Input and voice remain disabled, and
   approvals keep their content while their controls disable.
6. **GPU and text cannot disagree.** Both consume `presenceReadout`, one
   derivation; a test asserts the readout state equals `resolvePresenceState` for
   every phase.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit` | pass |
| `pnpm exec vitest run apps/desktop/src` | 26 files, **157 tests** pass (16 new) |
| `pnpm lint` (root tsc + structural lint) | `lint: clean` |
| `node scripts/run-gate.mjs fitness` | **17/17** pass |
| `pnpm build:desktop` (production export) | pass |
| `NEXT_PUBLIC_JARVIS_DEMO_MODE=1 pnpm build:desktop` | pass |
| `node scripts/inspect-presence.mjs` | 16/16 cases clean |
| `node scripts/qualify-presence.mjs --headless` | hardware accelerated, numbers above |
| Docker-dependent gates | unavailable (WSL engine still failed); not attempted |
| Live Kernel, live microphone, live provider | not exercised here — no Kernel in this worktree |

## Evidence

`docs/evidence/sentience-awakening/`

| File | Content |
|---|---|
| `gpu-ambient-headless.png` | Real GPU render, STANDBY, captured through CDP. |
| `gpu-approval-headless.png` | Real GPU render, approval sheet right, response column left. |
| `gpu-executing-headless.png` | Real GPU render, gold executing body with satellites. |
| `qualification-{ambient,approval,executing}.json` | Full measurement records, including caveats. |
| `layout-audit.json` | Every rect, overlap and focus measurement for 16 cases. |
| — | Intermediate SwiftShader captures were discarded: the GPU captures above supersede them, and keeping a mid-iteration frame as "after" would mislead. |

Genesis captures remain in `docs/evidence/sentience-genesis/` for the before side.

## Limitations

1. One machine, one GPU. The second-machine procedure exists but has not been run.
2. The first presence entry still costs ~230 ms of DOM mounting.
3. Voice is composed and correctly reports unavailability, but no physical
   microphone session has been proven — the Kernel was not running.
4. 1024×768 stacked layouts give the response only ~22px before scrolling; it is
   correct and scrollable, not comfortable.
5. `WORKSTATE.COMPLETE` remains unproduced upstream. VERIFIED no longer depends on
   it, but the gateway should arguably emit it; that is a Kernel change and was
   out of scope here.
6. Deferred: Workstream F's frame-time *distribution graph*, and any change to the
   command centre's visual identity.

## Recommended next steps

1. Run `scripts/qualify-presence.mjs` headful on the Kernel host and record it
   alongside `qualification-*.json`; that is the missing hardware qualification.
2. Prove one physical microphone session end-to-end (permission → publish →
   measured envelope → orb reaction) and record it as the first real voice
   evidence.
3. Decide whether the desktop gateway should emit `workState: 'COMPLETE'` after a
   verified invocation; if yes, the presence path already consumes it.
4. Only then revisit `jarvis.engineering.v1` (design already committed).
