# @jarvis/context

**Purpose.** The **Context Compiler** (`docs/architecture/COGNITION_MODEL.md`
§4). Fuses observations + Projected State + World Model queries + Memory recall
+ active objectives into a single budgeted `ContextFrame`. Implements the
**priority-tier fill within a hard context-unit budget** (review §16.12), the
multimodal fusion that resolves "this"/"there" (`PERCEPTION_MODEL.md` §4), and
explicit `unknowns` marking (L17).

**Owns.** No persistent state. Sensitivity classification of a frame (which can
force `locality` to `prefer-local`).

**Depends on.** `@jarvis/contracts`, and the read interfaces of
`@jarvis/state`, `@jarvis/world-model`, `@jarvis/memory`, `@jarvis/objectives`,
`@jarvis/scene`.

**Must not.** Call a model. Produce an unbounded frame. Emit "chat messages"
(the frame is structured). Write any store.

**Extraction seam.** Co-locate with the knowledge service (it queries World
Model + Memory heavily).
