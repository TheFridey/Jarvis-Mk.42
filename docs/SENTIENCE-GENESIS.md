# SENTIENCE · Genesis

Status: **IMPLEMENTED. AUTOMATED CHECKS PASSED. VISUAL EVIDENCE CAPTURED HEADLESSLY; HARDWARE QUALIFICATION OUTSTANDING.**

Presence Mode is a second experience over the existing Kernel projection. It does
not add authority, a store, a provider or a second renderer. It is the same Core
V2 orb, framed as a room instead of a workspace.

Baseline: `main` at `9c1b880`, clean. Branch `feature/sentience-genesis`, worktree
`D:\Projects\Jarvis-Sentience`.

## What Presence Mode is

One dominant living orb in a deep obsidian field, one word, one sentence, one
input field, genuine agent satellites, the approvals barrier when it exists, and
a quiet way back to the command centre. No model rail, no telemetry strip, no
panel grid, no lifecycle path, no permanent chrome.

Both experiences stay mounted in the same tree. `C` opens the command centre,
`P` returns to presence; the choice persists in `localStorage` under
`jarvis:mode:v1`, and `?mode=command` forces the workshop for a session. Presence
is the default because the assignment defines it as the primary screen; nothing
was deleted from the command centre to achieve that.

## Reuse, and the one thing added

Reused unchanged: the Kernel projection and its liveness contract, `useScene`,
`experience-phase-policy` (phase resolution and precedence), `core-visual-policy`
and `CoreSystemTargets`, `GpuEnvironment`, Forge Cosmos (`CinematicCore`, nebula,
`DriftField`, framing rig, quality tiers, AUTO measurement, fallback), `ApprovalBarrier`,
`spatialLayout`/`polar`, `visual-tokens`, the `agentField` policy, and the whole
command-centre tree.

One new renderer component: `cosmos/presence-atmosphere.tsx`. Justification: the
command-centre composition budgets its depth for a constellation of models,
agents and a lifecycle path, and its halo is tuned for a much smaller core. The
presence composition removes that structure and needs depth *behind* a large
sphere — three parallax dust shells, a wide low-frequency halo, two slow rim
rings. Drawing that in the command centre would imply a spatial field it does not
have, so it exists only when presence is active. It composes existing primitives
(`DriftField`, `discMaterial`, `ringMaterial`, shared clock, damping); it adds no
new shader, geometry family, dependency or state.

## Authoritative visual state

`presence-policy.ts` derives one of nine states from the existing phase and
projection, with an explicit, deterministic precedence:

| Order | State | Source |
|---|---|---|
| 1 | `DISCONNECTED` | `liveness.current === false` (stale/offline) |
| 2 | `FAULT` | `CRITICAL` health, `ERROR`, `BLOCKED` |
| 3 | `APPROVAL` | `pendingApprovals.length > 0` or phase `APPROVAL` |
| 4 | `EXECUTING` | `EXECUTING` / `VERIFYING` |
| 5 | `VERIFIED` | `COMPLETE` |
| 6 | `SPEAKING` | `RESPONDING`, or `voiceAudio.tts === 'playing'` |
| 7 | `LISTENING` / `THINKING` / `STANDBY` | remaining interaction and idle phases |

An approval outranks activity because it is the only state that needs the human.
Disconnection and fault outrank the approval *word* only — the approval card
itself is still rendered in every state, with its decision controls disabled
rather than its content hidden.

Nothing is invented. No microphone amplitude, no agent activity without a job,
no execution progress without capability state, and successful inference is never
presented as a verified effect. Ambient drift is artistic and carries no claim;
every word and sentence is derived from an observed field. `presenceCoreTargets`
only reduces orbit speed and steadies luminosity for the larger orb — colour and
semantics still come from `coreSystemTargets`.

## Satellites

`presenceSatellites` reuses `agentField` and then drops terminal jobs. Identity is
the agent id; angle is derived from sorted identity, so observation order can
never move an agent or fabricate a transfer. A satellite animates only with a
current observation and a confirmed lease/run, and never under reduced motion.
The six-identity cap is explicit. No contract change was required: `agentJobs`
already carries `jobId`, `agentId`, `parentJobId`, `state`, `activityConfirmed` and
`jobCount` is derived. A follow-up contract is *not* needed for this milestone.

## Visual composition

- Orb radius scales to the viewport (`.335 × height`, capped at `.235 × width`),
  with the readout horizon at `core.y + 1.1 × radius` so light never washes out
  the words.
- Three parallax dust shells at different depths and drift rates, a wide disc
  halo, and two slow counter-rotating rim rings; all damped, all disposed.
- Restrained palette only: obsidian, warm white, metallic gold, cool cyan, amber
  for attention, red for genuine failure — all from `visual-tokens`.
- Quality tiers, AUTO hysteresis, reduced-motion, low-power and hidden-window
  budgets are unchanged and still apply.
- Accessibility: the word is `role="status"` with the full sentence in its
  `aria-label`; the sentence is visible DOM text; approvals keep their alert
  dialog semantics; the input is a labelled form; the fallback states that state
  text is authoritative.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit` | pass (0 errors) |
| `pnpm exec vitest run apps/desktop/src/experience/presence/presence-policy.test.ts` | 26/26 pass |
| `pnpm exec vitest run apps/desktop/src` | 26 files, 141/141 pass |
| `pnpm lint` (root `tsc` + `scripts/lint.mjs`) | `lint: clean` |
| `node scripts/run-gate.mjs fitness` | 17/17 pass, including the desktop import boundary |
| `pnpm build:desktop` (Next production build, static export) | pass — `/` 226 kB first load |
| `NEXT_PUBLIC_JARVIS_DEMO_MODE=1 pnpm build:desktop` | pass — fixture build used for labelled captures |
| Docker-dependent gates | unavailable — Docker Desktop WSL engine still failed; not attempted |

### Visual evidence

The managed Chromium is unusable, but the system Chrome installation is
accessible, so the static export was served locally and captured with
`chrome --headless=new --enable-unsafe-swiftshader`. Every capture is real
output of the built app; the ones marked *fixture* were produced with
`NEXT_PUBLIC_JARVIS_DEMO_MODE=1` and carry the app's own DEMO MODE banner.

| File | What it shows |
|---|---|
| `docs/evidence/sentience-genesis/presence-disconnected-desktop.png` | Production build, no Kernel. DISCONNECTED, dimmed environment, no fabricated activity. |
| `docs/evidence/sentience-genesis/presence-disconnected-mobile.png` | Same state at 390 × 844. |
| `docs/evidence/sentience-genesis/presence-ambient-fixture-desktop.png` | Fixture: STANDBY, calm orb, one word, one sentence. |
| `docs/evidence/sentience-genesis/presence-approval-fixture-desktop.png` | Fixture: AWAITING YOU, full approval barrier docked right, word still readable. |
| `docs/evidence/sentience-genesis/presence-executing-fixture-desktop.png` | Fixture: EXECUTING, gold energy, agent satellites around the Core. |
| `docs/evidence/sentience-genesis/presence-ambient-fixture-mobile.png` | Fixture: 390 × 844 presence composition. |
| `docs/evidence/sentience-genesis/command-centre-fixture-desktop.png` | Fixture: the command centre still intact — model rail, telemetry, command deck. |
| `docs/evidence/sentience-genesis/presence-disconnected-fixture-desktop.png` | Fixture: the `disconnected` scenario as the app renders it. |

Defect found by looking at the captures and fixed before commit: the approval
barrier was centred over the orb and covered the state word. It now docks to the
right on wide viewports, and on narrow viewports (where no room exists for both)
the decision takes the screen while the readout stays in the accessibility tree.

These are presentation captures, not performance or hardware qualification: the
frames were rendered by SwiftShader at a fixed virtual-time budget, so they say
nothing about frame rate on real GPUs.

## Known limitations

1. Captures were rendered headlessly by SwiftShader; they prove composition and
   state presentation, not real-GPU behaviour, motion smoothness or input feel.
2. 60 FPS and integrated-GPU behaviour remain unverified (unchanged from the
   Forge Cosmos baseline).
3. Ambient atmosphere is artistic; it does not encode state beyond colour and
   energy damped from the state table.
4. Presence has no voice-input control of its own; the existing `AirTouchControl`
   and voice path remain command-centre affordances.
5. The engineering capability (`jarvis.engineering.v1`) is design-only in this
   phase; no runtime is connected and Jarvis V2 is untouched.

## Next milestone (proposed)

**Presence qualification.** One operator session on real hardware with three
captured states — idle, approval-required, disconnected — plus a measured FPS
trace from the development overlay. That closes the only gap this milestone
cannot: whether the room actually feels like one.
