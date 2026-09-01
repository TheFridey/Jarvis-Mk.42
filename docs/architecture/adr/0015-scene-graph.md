# ADR-0015: Scene Graph as the shared spatial abstraction

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
L32: physical and digital environments eventually share a coherent spatial
abstraction. L33: voice, gesture, gaze, cursor, and UI state combine to resolve
meaning. L37: future AR. If spatial concepts are invented ad hoc later
(one model for monitors, another for rooms, another for AR anchors), they
won't compose. But MK.42 has no AR and modest spatial needs (multi-monitor
layout, cursor/gaze targets).

## Decision
Define a single **Scene Graph** now (`packages/scene`, backed by a Kernel
`scene` schema and Redis for live positions), even though MK.42 populates only
a little of it:

- **Surfaces** — addressable presentation targets (each monitor, a voice
  channel, later an AR overlay), with geometry.
- **Nodes** — devices, with a position/pose in a coordinate space.
- **Spatial entities** — World Model entities may carry `spatialExtent`
  (a bounding volume / anchor) referencing a scene coordinate space.
- **Transient spatial signals** — gaze target, cursor dwell, hand pose — live
  in the frame, not persisted (`DATA_OWNERSHIP.md`).
- Coordinate spaces are explicit and relatable (screen space, workstation-desk
  space, room space), so an AR room anchor and a monitor rectangle can later
  be expressed in one hierarchy.

Rendering concerns (R3F/Three.js) live in the Experience Plane and consume the
Scene Graph; they do not define it.

## Alternatives considered
- **No spatial model until AR** — cheapest now, but guarantees an incoherent
  bolt-on later; violates the spirit of L32/L40.
- **Adopt a heavyweight spatial/AR framework now (OpenXR-centric world model)**
  — premature; most of it is unused for years and constrains the design to
  one vendor's worldview.
- **Fold spatial data into the World Model only** — the World Model is about
  *beliefs with provenance*; live surface geometry and node poses are a
  different concern with different consistency needs. Keep them separate but
  linkable via `spatialExtent`.

## Benefits
- Multimodal fusion (`PERCEPTION_MODEL.md` §4) has a place to resolve "this"
  and "there" from day one.
- AR, robotics, and multi-display attach into an existing coordinate hierarchy
  (L37, L38) instead of forcing a redesign.
- Clear split: Scene Graph = geometry/placement; World Model = beliefs;
  Experience = rendering.

## Disadvantages
- Some abstraction built ahead of full need (mitigated: MK.42 surface area is
  small — monitors, cursor/gaze targets).
- Coordinate-space math and calibration are genuinely hard when AR arrives
  (not solved now, but not blocked either).

## Risks
- The early model mis-predicts AR needs and needs revision. Mitigated: it is a
  small package behind interfaces; MK.51/MK.70 can extend coordinate spaces
  and anchor types additively.

## Consequences
- `packages/scene` and `packages/spatial` exist in the skeleton with the
  surface/node/coordinate-space types.
- World Model entities gain an optional `spatialExtent` referencing a scene
  coordinate space.
- Experience-Plane rendering depends on `packages/scene`, never vice versa.

## Reversal difficulty
**Low.** Little is built on it in MK.42. Reshaping the Scene Graph before AR
lands touches `packages/scene` consumers only (currently just the shell's
layout logic).
