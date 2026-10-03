# Forge Cosmos GPU renderer

Status: **IMPLEMENTED BUT NOT HARDWARE-VERIFIED**.

Forge Cosmos is the GPU presentation layer inside the existing Next.js/Tauri
desktop. It does not replace the Semantic Scene, own spatial state, or become a
Kernel component. `@jarvis/scene` and the realtime Operating Picture remain its
only semantic inputs. Three.js objects are disposable render representations.

## Boundary

React DOM owns text, status, commands, tables, cards, approvals, diagnostics,
focus behavior, and the visual-quality control. React Three Fiber owns only the
procedural environment: obsidian depth, stars, nebula volumes, metallic dust,
embers, technical geometry, neural connections, energy paths, and the Core.
The canvas is dynamically loaded on the client and has a truthful non-WebGL
fallback. WebGL is the baseline. WebGPU is deliberately not enabled until its
browser/Tauri support and fallback behavior can be proven robust.

## Mark 42 composition

One pure `spatialLayout()` (pixels) is shared by the DOM and the GPU scene, so
labels, controls and geometry always agree. The Core sits at the centre; the
model constellation sits on its right, split by a locality boundary (cloud
above, local below); agents orbit on the left; the execution path leaves the
Core towards the lower left and carries the approval barrier. Peripheral DOM
instruments (status edge, cognition matrix, telemetry, health alerts, activity
ribbon) stay at the edges. `O` (or the edge toggle) opens the dense OPERATIONS
view; the inspector holds developer detail.

Pure policies interpret projections before anything is drawn:
`experience-phase-policy` (phase, liveness, request flow),
`core-visual-policy`, `cognition-router-policy` (nodes and routing observations
from `activeModels`/`recentModelRuns` only), `session-cognition-stats`
(presentation-only, resets on restart), `telemetry-instrument-policy`,
`agent-field-policy` and `spatial-layout-policy`. Semantic colours and motion
come from `visual-tokens.ts`, mirrored as CSS variables in `globals.css`; a unit
test rejects colour literals in experience components.

Bloom spreads any non-finite pixel across the frame. Shader code must not call
`pow` with a possibly negative base, `atan(y, x)` at the origin, or produce
other undefined results on ANGLE/Direct3D; damped values must stay finite when
reduced motion snaps them.

Demo scenarios (`?scenario=` with `NEXT_PUBLIC_JARVIS_DEMO_MODE=1`) are loaded
only in demo mode from `visual-fixtures.ts`, use plainly synthetic names, refuse
commands and keep the DEMO MODE banner visible.

## Truth mapping

The visual policy derives `IDLE`, `REASONING`, `ROUTING`, `EXECUTION`,
`DEGRADED`, or `CRITICAL` from separate Operating Picture axes and health.
Reasoning increases cyan neural energy; routing adds directional paths;
execution increases forge-gold energy; degradation introduces restrained amber
asymmetry; only authoritative `OFFLINE` health produces localized red damage.
No animation claims model, agent, routing, execution, or health activity without
the corresponding projection state.

## Mark 42 Core V2 and sound

The central Core is a GPU representation composed of an outer field, three
orbital layers, a forge nucleus, radial waveform ring, verification scanner,
routing paths, confirmation shell and localised failure fracture. Its inputs
remain separate: authoritative `JarvisMode`, derived `InteractionState`, and
derived `WorkState`. `THINKING` belongs to work; `INTERPRETING` belongs to the
interaction. The DOM readout remains the accessible text source for states such
as `JARVIS — LISTENING` and `JARVIS — EXECUTING`.

`AudioVisualEnvelope` is a local, ephemeral presentation input containing only
normalised amplitude and low/mid/high envelopes. The bounded desktop bridge
rejects duplicate or out-of-order sequence values and clamps every band to
0..1. Raw PCM, microphone frames and TTS audio are not accepted, persisted or
sent over the Experience stream. A voice/TTS adapter may dispatch the local
`jarvis:audio-envelope` event when it has genuinely measured envelopes. The
current Windows speech adapter exposes recognition events, not amplitude, so
physical microphone/TTS reactivity is **implemented at the consumer boundary
but not hardware-verified**; the renderer does not fabricate a substitute.

The Web Audio sound identity is off by default and starts only after explicit
operator action. Cues are short transition sounds for wake, listening, routing,
approval, execution, verification, completion, warning and critical state.
Reduced sensory preference disables the control; there is no continuous sound.

## Performance budgets

| Tier | Dust | Stars | Neural nodes | Active cap | DPR | Bloom |
|---|---:|---:|---:|---:|---|---|
| LOW | 180 | 260 | 24 | 30 FPS | 0.75–1.0 | Off |
| MEDIUM | 360 | 520 | 42 | 45 FPS | 0.85–1.25 | On |
| HIGH | 680 | 900 | 68 | 60 FPS | 1.0–1.6 | On |
| ULTRA | 1100 | 1500 | 96 | 60 FPS | 1.0–2.0 | On |

Idle is capped at 12 FPS. Low-power ambient operation is capped at 15 FPS.
Reduced motion disables continuous motion and bloom and renders only on a
one-frame-per-second maintenance budget. A hidden document stops scheduling
frames. `AUTO` begins at HIGH and adjusts only after four consecutive measured
FPS samples outside the 42–57 FPS hysteresis band; it never infers capacity from
a GPU model name.

In development only, the renderer exposes measured FPS, frame time, Three.js
draw calls and triangle count, configured particle count, and resolved quality.
These are renderer measurements, not Kernel telemetry, and the overlay is absent
from production presentation.

The 60 FPS target has not been validated on workstation or integrated-GPU
hardware in this implementation pass. Browser and native Tauri performance must
be measured separately before either target is marked verified.
