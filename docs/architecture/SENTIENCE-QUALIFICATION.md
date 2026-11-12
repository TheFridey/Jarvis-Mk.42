# SENTIENCE · Presence qualification procedure

Status: **PROCEDURE + ONE MEASURED RUN ON THE DEVELOPMENT WORKSTATION.**
Not a certification, and not a claim about any second machine.

Purpose: replace "it looks fine in a screenshot" with numbers taken from the real
browser, the real compositor and the real GPU — and to make it impossible to
report a software rasteriser as hardware performance.

## 1. What is measured, and what is not

Measured:

| Metric | Source | Why it is trustworthy |
|---|---|---|
| GPU renderer | `UNMASKED_RENDERER_WEBGL` via `WEBGL_debug_renderer_info` | The driver's own string; a SwiftShader/llvmpipe string is reported as **not** hardware-qualified. |
| Frame pacing | `requestAnimationFrame` deltas over N frames | The same clock the renderer runs on; mean/p50/p95/p99/max and a count of frames over 33.4 ms. |
| JS heap | `performance.memory` | The browser's counters; omitted when the build does not expose them. |
| Mode switch | dispatch key → two painted frames | Includes layout, React mount and any shader work. |
| Keystroke latency | value set + input event → first painted frame | Not a full input-pipeline measure; it is the paint path only. |
| Reduced motion | `Emulation.setEmulatedMedia` → re-sample | A real media-feature emulation, not a CSS override. |

Not measured, and never inferred:

- real microphone capture, wake word or ASR accuracy;
- provider latency or model quality;
- anything requiring a running Kernel: this worktree has none.
- frame-time distribution as a chart (the percentile set is reported instead).

## 2. Prerequisites

- Windows ARM64 workstation, MSYS bash, pinned pnpm:
  `node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs"`.
- System Chrome or Edge present (the scripts find it; they never install one).
- A production export: `NEXT_PUBLIC_JARVIS_DEMO_MODE=1 pnpm build:desktop`
  for labelled fixtures, or `pnpm build:desktop` for the real disconnected state.
- Do not run Docker-dependent suites: the WSL engine is broken on this host.

## 3. Run the measurement

```bash
# Real GPU, real fidelity, one scenario at a time (writes a JSON + PNG to docs/evidence/sentience-awakening)
node scripts/qualify-presence.mjs --headful --scenario ambient   --screenshot
node scripts/qualify-presence.mjs --headful --scenario executing --screenshot
node scripts/qualify-presence.mjs --headful --scenario approval  --screenshot

# Fewer frames when time is short (default 240)
node scripts/qualify-presence.mjs --headful --frames 120

# Software renderer, for a like-for-like floor rather than a GPU claim
node scripts/qualify-presence.mjs --headless --screenshot
```

Reading a result:

- `hardwareAccelerated: false` or a renderer containing `SwiftShader`, `llvmpipe`
  or `Basic Render` means the numbers are a **floor**, and the run must be labelled
  software.
- `idle.fps` near 60 with `p95Ms` near 16.7 means vsync-locked pacing. A `p95`
  well above 16.7 with a low `over33ms` means occasional jank rather than load.
- `toPresenceMs` on the first entry includes the DOM mount; `toPresenceWarmMs` is
  the steady-state cost. Compare both; do not report only the better one.

## 4. Run the layout audit

```bash
node scripts/inspect-presence.mjs                 # 4 viewports × 4 scenarios, headless
node scripts/inspect-presence.mjs --headful       # same, visible
node scripts/inspect-presence.mjs --only 390x844  # one viewport
```

It fails (`exit 2`) on any overlap, viewport overflow, or a long answer crossing
the input, and writes every rect it measured to `layout-audit.json`. Hidden
surfaces are excluded deliberately: a suppressed element cannot collide with
anything, and reporting it would train people to ignore the audit.

## 5. Manual checks the scripts cannot make

Do these with the Kernel running, on the target machine, once per release:

1. **Idle**: word `STANDBY`, no motion until something happens; no agent labels.
2. **Listening**: speak; confirm `LISTENING`, then `THINKING`, then a response.
3. **Speaking**: only with audio actually playing — the word must be `SPEAKING`,
   and must return to `STANDBY` within ~3 s of the audio stopping.
4. **Approval**: trigger a real approval; the sheet must appear without covering
   the word, and `AUTHORISE` must be the only path that acts.
5. **Disconnect**: stop the Kernel; `STALE`/`DISCONNECTED` within the freeze
   window, input and microphone disabled, approvals still visible but inert.
6. **Reconnect**: state returns without a page reload.
7. **Reduced motion**: enable it in the OS; continuous motion stops, the word and
   sentence still update.
8. **Long answer**: ask something that produces several hundred words; the
   response scrolls, expands on demand, and never covers the orb or the input.

## 6. Recording

- JSON records and screenshots go to `docs/evidence/sentience-awakening/`.
- Name manual runs `qualification-manual-<machine>-<date>.json` and state the GPU
  string in the commit message.
- Never present a headless SwiftShader capture as hardware evidence, and never
  present fixture data as live system behaviour: the app's own DEMO MODE banner is
  the marker.

## 7. Baseline on the development workstation

Windows 11 ARM64, Qualcomm Adreno X1-45, ANGLE/D3D11, headless Chrome:

| Scenario | Idle FPS | p95 | frames > 33 ms | Heap | Switch to presence (warm) |
|---|---|---|---|---|---|
| STANDBY | 60.0 | 16.7 ms | 0 | 14.6 MiB | 34.1 ms |
| APPROVAL | 55.1 | 16.8 ms | 1 | 12.2 MiB | 33.3 ms |
| EXECUTING | 54.9 | 16.8 ms | 1 | 14.4 MiB | 33.3 ms |

Keystroke → paint 15.9–16.6 ms; switch to command centre 33 ms warm, 66–85 ms
first; presence first entry 217–233 ms (DOM mount). Reduced-motion idle mean
16.67 ms.
