# @jarvis/spatial

**Purpose.** Coordinate-space math for the Scene Graph (ADR-0015): coordinate
space definitions (screen space, desk space, room space), transforms between
them, bounding volumes and anchors. Pure geometry — no rendering, no beliefs.

**Owns.** No state. Math + types.

**Depends on.** `@jarvis/contracts` only.

**Must not.** Render anything (Experience Plane / R3F does that). Store entity
beliefs (World Model does that; entities merely *reference* a coordinate space
via `spatialExtent`).

**Extraction seam.** Travels with `@jarvis/scene`.

**MK.42 scope.** Minimal — screen/desk spaces for multi-monitor layout and
cursor/gaze targets. Room space and AR anchors arrive with `ROADMAP.md`
MK.51 / MK.70.
