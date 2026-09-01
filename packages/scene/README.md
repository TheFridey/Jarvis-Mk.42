# @jarvis/scene

**Purpose.** The **Scene Graph** (ADR-0015, L32/L33/L37): the shared spatial
abstraction unifying physical space and digital surfaces. Surfaces (each
monitor, a voice channel, later an AR overlay) with geometry; node poses;
entity `spatialExtent` references; the coordinate-space hierarchy. Rendering
consumes it; rendering does not define it.

**Owns.** The `scene` schema for durable placement (surfaces, calibrated node
poses, coordinate spaces); Redis for live positions.

**Depends on.** `@jarvis/contracts`, `@jarvis/spatial`, a PostgreSQL client.

**Must not.** Hold beliefs-with-provenance (World Model). Do transient signal
fusion (that is the Context Compiler — gaze/cursor/hands live in the frame,
not here). Contain rendering code.

**Extraction seam.** → a scene service.
