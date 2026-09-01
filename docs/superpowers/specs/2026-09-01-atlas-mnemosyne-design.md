# ATLAS + MNEMOSYNE — Design Spec

Phase: **MK.46 "Knowledge"** (`ROADMAP.md`).
Status: **Draft for review.**
Subordinate to `docs/architecture/PRINCIPLES.md` (the 40 laws), `KERNEL_CONSTITUTION.md`,
the model documents, and the ADRs. A contradiction with any of those is a bug in
this spec.

Repo maturity at authoring time: **MK.43** (spine only — Identity, Session, Event
Manager, State Manager, Modes, Presence, Health, Scheduler, Notifications,
deterministic Context Compiler, Diagnostics). No Policy/Permission Engine
(MK.44), no Model Gateway / Agent Runtime (MK.45) yet.

Agreed build depth: **full architecture + contracts + schemas + ADRs first, this
document reviewed, then services implemented incrementally in-phase against
stubbed MK.44/45 dependencies behind interfaces.**

---

## 1. Purpose & scope

Design two systems that must remain distinct from each other and from the Kernel
state subsystem:

- **ATLAS** — the temporal world model. *What JARVIS currently believes about the
  world, and why.*
- **MNEMOSYNE** — memory. *What JARVIS has retained from experience and learned
  knowledge.*

Authoritative system state (objective status, grants, mode, sessions, presence)
remains owned by the Kernel State Manager and the other frozen-16 components.
Neither ATLAS nor MNEMOSYNE may become another State Manager, and MNEMOSYNE may
not become a dumping ground for arbitrary state.

### 1.1 Naming

- **ATLAS** (capitalised) — the temporal world model subsystem. Package
  `packages/world-model`, schema `atlas`.
- **MNEMOSYNE** (capitalised) — the memory subsystem. Package `packages/memory`,
  schema `mnemosyne`.
- `agents/atlas` (data analysis) and `agents/mnemosyne` (memory curation) are
  **unchanged** disposable workers. The Glossary disambiguates subsystem vs
  agent, as it already does for `JarvisMode.FOCUSED` vs `PresenceState.FOCUSED`.

### 1.2 In scope

Entity/relationship/fact model with temporal semantics; provenance, confidence,
epistemic status; contradiction handling; an observation layer with a promotion
pipeline; causal-hypothesis **foundations**; five durable memory classes; a
memory-candidate scoring pipeline; scheduled consolidation ("DREAMING"); a
morning-insight mechanism; multi-factor retrieval for both subsystems; forgetting
(expiry, decay, archival, deletion); privacy classification; auditability.

### 1.3 Out of scope this phase

A causal-inference engine (only the typed store + write discipline ship). Live
agent-assisted consolidation (deterministic rules first; `mnemosyne` agent wired
in when the Agent Runtime exists at MK.45). Any Neo4j / dedicated graph or vector
database (ADR-0011 stands — pgvector in the same PostgreSQL). Multi-user data
(the `principalId` column and predicates exist; only one principal runs).

### 1.4 Constitutional grounding

- **L8** already mandates Memory and the World Model as distinct packages,
  schemas, and service APIs that never write each other.
- **L5 / ADR-0017** already forbid duplicated authority; every state category has
  exactly one owner component.
- **L11–L17** already mandate provenance, confidence, epistemic status, temporal
  validity, evidence, uncertainty, and "I don't know" as a real answer.
- **`MEMORY_CANDIDATE`** retention class already exists in `EVENT_ARCHITECTURE.md`
  for "a future Memory service [to promote] these".
- Extraction seam #1 (`SYSTEM_BOUNDARIES.md` §10) is "World Model + Memory → a
  read-heavy knowledge service" — this design preserves it (both lift out
  together).

This spec designs *within* those laws and *extends* the boundary (causal
foundations, memory classes, consolidation, retrieval, insight) without breaking
it. Section 8 is the required proof.

---

## 2. Structural decision

**Approach A — two peer protected subsystems behind one Knowledge Ingestion
mediator.**

- `packages/world-model` (ATLAS) and `packages/memory` (MNEMOSYNE): separate
  schemas (`atlas.*`, `mnemosyne.*`), separate read service interfaces
  (`AtlasQuery`, `MemoryRecall`), separate single owners.
- **Knowledge Ingestion** is a Kernel-internal protected service — exactly the
  status the Capability Executor holds: named and protected in the Kernel
  Constitution, but **not** a 17th entry in the frozen 16. It is the **only**
  writer to `atlas.*` and `mnemosyne.*`.
- Perception, cognition, agents, and interfaces never write either schema. They
  emit observations, validated proposals, or principal-assertion commands
  (`WORLD_MODEL.md` §4 already requires this).
- "DREAMING" consolidation is a Scheduler routine that reads events + episodes
  and emits **proposals** back through Knowledge Ingestion — it never writes
  either schema directly.
- Retrieval stays per-subsystem. Only the Context Compiler (frozen-16 component
  #5) fuses ATLAS facts and MNEMOSYNE episodes, into its budgeted `ContextFrame`.

Rejected: **B** (fully independent pipelines — duplicates entity resolution,
provenance stamping, untrusted tagging, privacy classification in two codebases;
makes the no-duplicate-authority proof harder). **C** (one "Knowledge" subsystem
with ATLAS/MNEMOSYNE as internal modules — directly fights L8 and the brief's
core mandate).

---

## 3. Knowledge Ingestion

### 3.1 Pipeline

One write path, four input kinds:

```
observation event ─────────┐
validated cognition proposal┤→ Knowledge Ingestion:
principal assertion (Command)┤     classify → stamp provenance → set privacyClass
promoted MEMORY_CANDIDATE ──┘     → entity resolution (once)
                                  → route (table §3.2)
                            ┌─────────────┴─────────────┐
                            ▼                           ▼
                  ATLAS write (belief)        MNEMOSYNE write (experience)
                  fact / relationship /       episode / semantic / candidate
                  observation-index /         cross-link: evidence.ref = episodeId
                  causal hypothesis
                            │                           │
                  emit jarvis.world.*         emit jarvis.memory.*
```

Every write is a **separate record**. When one input carries both a belief and an
experience (e.g. "Rhys said in this chat he prefers X"), ATLAS gets a derived
fact (`epistemicStatus: asserted`, `evidence.kind: principal_assertion`,
`ref = episodeId`) and MNEMOSYNE gets the episode. The episode text is never
duplicated into ATLAS (`WORLD_MODEL.md` §8, review §16.1).

### 3.2 Routing table (deterministic)

| Incoming | ATLAS gets | MNEMOSYNE gets |
|---|---|---|
| Perception observation | observation-index row (+ promotion candidacy) | nothing (raw signal is not experience) |
| Proposal: extracted fact about an entity | fact + evidence | nothing |
| Proposal: notable episode / action outcome | nothing | episode |
| Proposal carrying both | derived fact citing the episode id | the episode |
| Principal assertion (Command) | fact, `epistemicStatus: asserted` | episode of the correction, if conversational |
| DREAMING insight proposal | fact/hypothesis, `epistemicStatus: inferred`/`derived`, evidence → episodes/events | consolidation episode recording the run |

### 3.3 Responsibilities the mediator centralises

Provenance stamping (mandatory, L11); untrusted tagging
(`provenance.derivedFromUntrusted = true` when the evidence chain includes
untrusted web/external data — review §16.8); `privacyClass` assignment; entity
resolution (deterministic keys → pgvector similarity → create-or-`candidate_merge`,
`WORLD_MODEL.md` §7); dedupe / supersession / conflict decision
(`WORLD_MODEL.md` §5); event emission after write.

### 3.4 What it must never do

Reason (no Model Gateway import). Make a policy decision. Write `projections.*`
or any frozen-16 component's schema. Accept an untyped input. Emit an ATLAS fact
without provenance/confidence/epistemicStatus. Copy episode content into ATLAS.

---

## 4. ATLAS — the temporal world model

### 4.1 Entities

Canonical type vocabulary (documented enum in `ATLAS_MODEL.md`, still an open set
— new types are data, not code): `person`, `organisation`, `business`, `project`,
`device`, `node`, `location`, `room`, `repository`, `software`, `service`,
`document`, `infrastructure`, `account`, `objective`, `asset`, `physical_object`,
`concept`, `event`.

Every entity row:

| Field | Notes |
|---|---|
| `id` | ULID, stable |
| `type` | from the vocabulary above |
| `canonicalName` | string |
| `aliases` | `text[]` — **new** vs current contract |
| `metadata` | `jsonb` — **new** |
| `privacyClass` | `PUBLIC \| INTERNAL \| SENSITIVE \| RESTRICTED` (reuses the event envelope enum) — **new** |
| `principalId` | scoping key (L34) |
| `spatialExtent` | optional Scene Graph reference (existing) |
| `createdAt`, `updatedAt` | existing |

**Reference-shell entities.** `objective`, `node`, `device` entities are identity
nodes only — the authoritative record lives in `projections.objectives` /
`projections.nodes`. ATLAS holds the shell so facts and relationships can point
at it; ATLAS never writes the projection.

### 4.2 Relationships (first-class, temporal)

`atlas.entity_relationships` — extends the current contract:

| Field | Notes |
|---|---|
| `id`, `fromEntityId`, `toEntityId`, `type` | existing; `type` open vocabulary (founded, serves, uses, located_in, hosts, deployed_to, belongs_to, currently_in, owns, member_of, depends_on, …) |
| `provenance`, `confidence` | existing, mandatory |
| `validFrom`, `validTo` | existing — relationships are **not** eternally true |
| `observedAt` | **new** — when the supporting evidence was seen, distinct from when the relationship became true |
| evidence | via the shared `evidence` table, `subjectKind` discriminator |

Relationship queries are always time-scoped, mirroring the fact query API.

### 4.3 Facts

`atlas.facts` — extends the current `Fact` contract:

| Field | Notes |
|---|---|
| `id`, `subjectEntityId` | existing |
| `attribute` | existing key form |
| `predicate` | **new** — subject-predicate-object form alongside `attribute`; a fact is never merely `key = value` |
| `value` | existing (JSON-serialisable) |
| `factType` | **documented as ≡ `epistemicStatus`**: `observed \| asserted \| retrieved \| inferred \| predicted \| derived`. JARVIS treats these as meaning different things (authority ranking §4.4). |
| `epistemicStatus` | existing, mandatory, never defaulted (L14) |
| `provenance` | existing, mandatory (L11) |
| `confidence` | existing, mandatory 0..1 (L12) |
| `validFrom`, `validTo` | existing (L13) |
| `status` | **new** — `active \| superseded \| retracted \| expired` |
| `supersedesFactId` | existing |
| `contradictionOf` | **new** — `ulid[]` explicit links, complementing the `conflicts` table |
| `createdAt`, `supersededAt` | `supersededAt` **new**, for `changedBetween` queries |

`atlas.facts_archive` — same shape; superseded / expired facts move here (LIST
partition by `status`), out of the hot query path, evidence graph retained.

### 4.4 Belief revision

Carried over unchanged from `WORLD_MODEL.md` §5:

- **Supersession** — newer authoritative fact sets `supersedesFactId` on itself
  and `validTo = now` on the old; old fact archived after `validTo`.
- **Conflict, not overwrite** — disagreeing facts with no clear authority both
  persist; a `conflicts` row opens; cognition sees both with confidences; a
  principal assertion resolves it.
- **Authority ranking** for automatic resolution: `asserted` (principal) >
  `observed` > `retrieved` (trusted) > `derived` > `inferred` > `predicted`;
  ties break by recency; still-ambiguous ⇒ leave `open`.
- Nothing silently deleted; belief history reconstructable from `facts` +
  `facts_archive` + `events`.

### 4.5 Observation layer

`atlas.observations` (already an index into expiring signal events, with
`promotedToFactId`). This phase adds fields and a **promotion pipeline**:

| Field | Notes |
|---|---|
| `id`, `eventId`, `kind`, `summary`, `observedAt` | existing |
| `source` | producing component / sensor |
| `confidence` | 0..1 |
| `location` | `{ spaceId, ref? }` |
| `rawRef` | evidence-artifact blob reference (object storage) |
| `expiresAt` | rolling window; unpromoted observations are dropped |
| `promotedToFactId` | existing |

**Promotion is not automatic on arrival.** A scheduled promotion evaluator
aggregates corroborating observations; above a confidence/corroboration
threshold it emits a **proposal** to Knowledge Ingestion to write a fact. "ARGUS
saw a person-shaped object in the office" contributes evidence weight toward
"Rhys is in the office"; it is not that fact. Not all observations become facts.

### 4.6 Causal hypotheses (foundations only)

New table `atlas.causal_hypotheses`:

| Field | Notes |
|---|---|
| `id` | ULID |
| `causeRef`, `effectRef` | each an entity / fact / event id |
| `relationKind` | `chronological \| correlated \| hypothesised_cause \| established_cause` |
| `confidence` | 0..1 |
| `evidence` | `ulid[]` supporting refs |
| `method` | how it was derived |
| `validFrom`, `validTo`, `status` | temporal + lifecycle |

The enum **is** the safeguard. Nothing writes `established_cause` except an
explicit principal assertion or a deterministic derivation with named rule
support. Cognition proposals may reach at most `hypothesised_cause`. The query
API returns `relationKind` verbatim so no consumer can present a hypothesis as a
proven cause. No causal-inference engine ships this phase — only the typed store
and the write discipline. Rationale in ADR-0021.

---

## 5. MNEMOSYNE — memory

### 5.1 Memory classes

Five durable classes are schema-backed; three transient/borrowed classes are
pointers, not stores.

| Class | Realisation | Owner of truth |
|---|---|---|
| **Episodic** | `mnemosyne.episodes` — time bounds, participants (entity ids), summary, body ref, source-event ids, `salience`, embedding | MNEMOSYNE |
| **Semantic** | `mnemosyne.semantic` — durable learned concept/knowledge statements, embedding, source episodes | MNEMOSYNE |
| **Procedural** | `mnemosyne.procedures` — named repeatable processes: ordered `{ step, action, checkRef }[]`, `version`, `lastValidatedAt` | MNEMOSYNE |
| **Preference** | `mnemosyne.preferences` — **non-sensitive interaction preferences only**; `privacyClass` capped at `INTERNAL`; sensitive personal facts go to ATLAS, not here | MNEMOSYNE |
| **Entity memory** | a **view / query**, not a table: episodes + semantic rows linked to an ATLAS entity id | MNEMOSYNE (index) / ATLAS (entity identity) |
| Working | Kernel Ephemeral (Redis). MNEMOSYNE **reads** it during consolidation; never persists it | Ephemeral store |
| Session | projection over `session.*` + episode links; no new store | Session Manager |
| Spatial | reference to Scene service placements; MNEMOSYNE stores only an episode's `sceneRef` | Scene service |

This split is the boundary argument against L5 / ADR-0017: working and session
memory are not re-owned by MNEMOSYNE.

### 5.2 Memory Candidate pipeline

`mnemosyne.candidates` — events tagged `retentionClass: MEMORY_CANDIDATE` plus
session/objective outcomes land here first. A scorer computes weighted factors,
storing the component breakdown (auditable, tunable):

`novelty`, `importance`, `futureUtility`, `objectiveRelevance`, `confidence`,
`duplication` (penalty), `sensitivity` (penalty/defer), `durability`,
`sourceQuality` → `candidateScore`.

Disposition: `accepted | merged | rejected | expired | deferred`, each emitting
`jarvis.memory.candidate.*`. Nothing becomes an episode without passing this
gate. Not every conversation line is stored.

### 5.3 Consolidation ("DREAMING")

A Scheduler routine `memory.consolidate` (off-peak cadence). **Not** cognition
with authority: it reads events, episodes, candidates, objective progress,
procedures; it produces **proposals only**, routed back through Knowledge
Ingestion.

Operations: compress repetition; merge duplicate episodes; promote durable
knowledge to semantic memory; strengthen well-supported knowledge (confidence
up); decay stale assumptions (confidence down); surface contradictions (→ ATLAS
`conflicts`); update procedures from repeated action patterns; archive transient
episodes; propose cross-domain links.

**Every generated insight retains evidence / provenance.** A consolidation output
with no evidence chain is rejected by Knowledge Ingestion. `mnemosyne.consolidation_runs`
records each pass (inputs scanned, proposals emitted, outcomes) for auditability.

The `mnemosyne` agent may be *invoked by* this routine for summarisation /
linking once the Agent Runtime exists (MK.45). Until then the routine runs
deterministic rules only. It is knowledge consolidation, not consciousness.

### 5.4 Morning Insight

`mnemosyne.insights` — consolidation writes candidate insights with
`significance`, `evidence[]`, `surfaced boolean`, `supersededBy`. A surfacing
check emits `jarvis.memory.insight.available` **only** when: significance ≥
threshold **and** relevant to a current objective/context **and** not already
surfaced **and** evidence-backed. The **Notification Manager** (frozen-16
component #14) delivers it under its normal interruption gate. The pipeline
producing zero insights is the expected normal case — no insight is fabricated
to appear intelligent.

---

## 6. Retrieval & temporal queries

### 6.1 `AtlasQuery` service interface

| Method | Answers |
|---|---|
| `currentlyBelieved(entity, attribute?)` | "What is true now?" — `validFrom <= now < validTo`, ranked by confidence |
| `believedAt(entity, attribute?, t)` | "What was true yesterday?" — time-travelled, includes `facts_archive` |
| `changedBetween(t1, t2, filter?)` | "What changed today / this week / after deployment X?" — facts whose `validFrom`, `validTo`, or `supersededAt` is in the window (caller supplies the deployment boundary) |
| `history(entity, attribute)` | "When did relationship Y begin? What did we previously believe?" — full ordered chain incl. superseded |
| `evidenceFor(factId)` | "What evidence supports this?" — the evidence subgraph |
| `relationships(entity, at?, kinds?)` | time-scoped relationship neighbourhood |
| `causal(ref, direction)` | causal hypotheses touching a node; `relationKind` returned verbatim |

Every method can return `{ known: false }` as a real result (L17), distinct from
a low-confidence hit.

### 6.2 `MemoryRecall` service interface

Recall is **always** `top-k` + relevance floor (never "all relevant" — review
§16.12). Relevance is a weighted composite computed in one SQL query over
pgvector + scalar columns:

```
relevance =
    w_sim  · semanticSimilarity(queryEmbedding, row.embedding)   -- pgvector, ONE bounded factor
  · w_ent  · entityOverlap(queryEntities, row.participants)
  · w_rec  · recencyDecay(now - row.occurredAt)
  · w_imp  · row.salience
  · w_obj  · objectiveRelevance(row, activeObjectives)
  · w_conf · row.confidence
  · w_src  · sourceAuthority(row.provenance.method)
```

Weights live in config and are logged with each recall for tuning. `w_sim` is
bounded so similarity alone cannot dominate — cosine similarity does not dictate
truth (ADR-0023). Class filter and `principalId` scope are SQL predicates, not
post-filters.

### 6.3 Fusion

Neither API calls the other. The Context Compiler queries `AtlasQuery`
(time-scoped facts) and `MemoryRecall` (top-k episodes) independently, then fills
its priority-tiered budget (`COGNITION_MODEL.md` §4.2): facts before episodes,
both before supporting material. `ContextFrame.freshness` carries `atlasAsOf` /
`memoryAsOf`.

---

## 7. Forgetting, privacy, auditability

### 7.1 Forgetting

"Store everything forever" is forbidden. Each mechanism has one owner and emits
an event.

| Mechanism | ATLAS | MNEMOSYNE |
|---|---|---|
| Expiry | observations past `expiresAt`; facts past `validTo` → `facts_archive` | episodes/candidates past class TTL; raw bodies → object storage, metadata + embedding kept hot |
| Supersession | `supersedesFactId` + archive old | episode merge → `supersededBy`; procedure version bump |
| Confidence decay | consolidation lowers confidence on stale uncorroborated `inferred`/`predicted` facts; below floor → `status: expired` | low-relevance semantic rows: `relevance × age` → prune candidate |
| Archival | `facts_archive` partition, evidence retained | rolling summaries replace raw episodes; bodies to MinIO |
| Manual / privacy deletion | `atlas.forget(entityId \| factId, reason)` — hard-deletes rows **and** evidence, writes a `jarvis.world.forgotten` tombstone (id + reason + actor, no content) | `mnemosyne.forget(episodeId \| subjectRef, reason)` — same pattern, cascades to derived semantic rows |
| Retention rules | per entity-type + privacyClass table in `ATLAS_MODEL.md` | per memory-class + privacyClass table in `MNEMOSYNE_MODEL.md` |

Deletion is the one operation that genuinely removes data (right-to-erasure);
everything else archives. Ledger events are never touched (`STATE_MODEL.md` §6);
a tombstone event records *that* a forget happened.

### 7.2 Privacy

`privacyClass` (`PUBLIC | INTERNAL | SENSITIVE | RESTRICTED`, the event-envelope
enum) on every entity, fact, relationship, episode, semantic row, preference.

- Preference memory capped at `INTERNAL`; sensitive personal data belongs in
  ATLAS facts, not preferences.
- `RESTRICTED` knowledge never enters a `ContextFrame` bound for a non-local
  model (Context Compiler filters on it — mechanism already exists).
- Untrusted-derived facts carry `derivedFromUntrusted` and cannot alone justify
  `riskClass > LOW` (review §16.8).
- Every row `principalId`-scoped from day one (L34); multi-user isolation is a
  row filter, not a re-architecture.

### 7.3 Auditability

| Question | Answered by |
|---|---|
| "Why do you remember that?" | `mnemosyne.candidates.scoreBreakdown` + `consolidation_runs` |
| "When did you learn that?" | `createdAt` + originating `correlationId` |
| "Where did that come from?" | `provenance` (mandatory) + `evidence[]` chain |
| "Is that a fact or an inference?" | `epistemicStatus` / `factType` (mandatory, never defaulted) |
| "How confident are you?" | `confidence` (mandatory) |
| "Did you used to believe something different?" | `history()` + `facts_archive` + `conflicts` |

No new audit store — the Audit Manager (component #16) derives from the
`jarvis.world.*` / `jarvis.memory.*` events, which all carry provenance +
`correlationId`.

---

## 8. Boundary proof (the mandated review)

Proven here, written into ADR-0020, and re-verified by the Section 10 boundary
tests.

1. **World Model ≠ State Manager.** ATLAS holds beliefs about the world
   (`atlas.facts`, provenance/confidence/temporal validity). The State Manager
   holds system state (`projections.*`: objective status, grants, mode). Different
   schemas, owners, question. No write path exists from ATLAS to `projections.*`.
   "JARVIS's objective is active" is a projection, not an ATLAS fact. ADR-0017
   already forbids the overlap; this design adds no violating path.
2. **Memory ≠ World Model.** MNEMOSYNE stores episodes (narrative, lossy,
   decaying). ATLAS stores facts (structured, provenance-bound, revised not
   deleted). The only coupling is evidence pointers — an ATLAS fact may cite a
   MNEMOSYNE episode id. Content is never copied. Neither writes the other; only
   Knowledge Ingestion writes, and it writes them as separate records.
3. **Memory ≠ event log.** The Event Log is authoritative, ordered, append-only
   history. MNEMOSYNE episodes are curated, compressible, decaying interpretations
   built from events, with their own retention. Losing MNEMOSYNE loses recall
   quality, not history. `MEMORY_CANDIDATE` retention class already models the
   promotion step.
4. **Vector store ≠ source of truth.** pgvector columns are similarity indexes
   only (ADR-0011). Retrieval ranking uses similarity as one bounded factor among
   seven; no query returns truth because cosine distance was small. Contradiction
   resolution never consults embeddings.
5. **No duplicate authority.** Every category this design introduces — entities,
   relationships, facts, observation-index, causal hypotheses, episodes, semantic
   memory, procedures, preferences, candidates, consolidation runs, insights — has
   exactly one owner (ATLAS or MNEMOSYNE service), one writer (Knowledge
   Ingestion), one schema. Added to `DATA_OWNERSHIP.md` §1 as new rows before
   code.

---

## 9. Deliverables

### 9.1 Contracts (`packages/contracts/src/`)

| File | Change |
|---|---|
| `entity.ts` | + `aliases`, `metadata`, `privacyClass`; document canonical type vocabulary |
| `fact.ts` | + `predicate`, `status`, `contradictionOf[]`, `supersededAt`; document `factType` ≡ `epistemicStatus` |
| `entity.ts` (relationship) | + `observedAt`, evidence linkage |
| `causal.ts` | **new** — `CausalHypothesis`, `RelationKind` |
| `observation.ts` | + `expiresAt`, `location`, `rawRef`, `source` on the persisted ATLAS-index shape |
| `memory.ts` | **new** — `Episode`, `SemanticMemory`, `Procedure`, `Preference`, `MemoryClass` |
| `memory-candidate.ts` | **new** — `MemoryCandidate`, `CandidateScore`, `CandidateDisposition` |
| `memory-insight.ts` | **new** — `Insight`, `InsightSignificance` |
| `knowledge-ingestion.ts` | **new** — `IngestionItem` union, `RoutingDecision`, `KnowledgeIngestion` port |
| `atlas-query.ts` | **new** — `AtlasQuery` read interface |
| `memory-recall.ts` | **new** — `MemoryRecall` read interface |
| `event-names.ts` | + `jarvis.world.*` (`fact.asserted`, `fact.superseded`, `conflict.recorded`, `entity.merged`, `forgotten`, `causal.hypothesised`), `jarvis.memory.*` (`episode.recorded`, `candidate.scored`, `candidate.disposed`, `consolidation.completed`, `insight.available`, `forgotten`) |

### 9.2 Schemas (`packages/persistence/src/migrations/`)

- `0005_atlas.sql` — `atlas` schema: `entities`, `entity_aliases`,
  `entity_relationships`, `facts`, `facts_archive`, `evidence`, `conflicts`,
  `observations`, `causal_hypotheses`; pgvector columns + HNSW indexes; `facts`
  LIST-partitioned by `status`; `principalId` on every table; per-schema DB role.
- `0006_mnemosyne.sql` — `mnemosyne` schema: `episodes`, `semantic`,
  `procedures`, `preferences`, `candidates`, `consolidation_runs`, `insights`;
  pgvector + HNSW; `episodes` class/time-partitioned; `principalId` everywhere;
  per-schema DB role.

### 9.3 Packages / modules

- `packages/world-model/src/` — `AtlasService` (impl `AtlasQuery`), ingestion
  handlers, promotion evaluator, archival job.
- `packages/memory/src/` — `MemoryService` (impl `MemoryRecall`), candidate
  scorer, consolidation routine, insight surfacer, decay job.
- `apps/core/src/kernel/knowledge/` — Knowledge Ingestion mediator (single
  writer), routing table; wired to the event bus + Scheduler + Notification
  Manager.

### 9.4 ADRs (`docs/architecture/adr/`)

| ADR | Subject |
|---|---|
| `0020-knowledge-subsystem-boundary.md` | ATLAS/MNEMOSYNE as peer protected subsystems; Knowledge Ingestion as an Executor-class internal service (not a frozen-16 change); the five-point no-duplicate-authority proof |
| `0021-causal-hypothesis-model.md` | The `RelationKind` ladder, write discipline, foundations-only rationale, no graph DB |
| `0022-memory-consolidation.md` | DREAMING as a Scheduler routine emitting proposals only; deterministic-rules-first, agent-assisted later; evidence-mandatory insights |
| `0023-memory-retrieval-ranking.md` | Seven-factor weighted recall; similarity bounded; config-tuned; complements (does not supersede) ADR-0011 |

### 9.5 Doc updates

- **New** `docs/architecture/ATLAS_MODEL.md`, `docs/architecture/MNEMOSYNE_MODEL.md`
  (superseding the `WORLD_MODEL.md` sketch — that file becomes a pointer;
  `STATE_MODEL.md` §Memory likewise).
- `DATA_OWNERSHIP.md` §1 — new owner rows for every category listed in §8 point 5.
- `GLOSSARY.md` — ATLAS / MNEMOSYNE subsystem entries + agent disambiguation;
  `factType`, `RelationKind`, `MemoryClass`, `MemoryCandidate`, DREAMING,
  Morning Insight.
- `ROADMAP.md` — MK.46 status.
- **New diagrams** `docs/architecture/diagrams/atlas-ingestion.mmd`,
  `mnemosyne-consolidation.mmd`.
- `KERNEL_CONSTITUTION.md` — one sentence noting Knowledge Ingestion as an
  Executor-class protected internal service (no change to the frozen 16;
  cross-references ADR-0020).

---

## 10. Testing

`@jarvis/testkit` ephemeral PostgreSQL, mirroring the MK.43 pattern
(self-skip when Docker is unavailable).

| Area | Cases |
|---|---|
| Facts & belief revision | conflicting facts coexist + `conflicts` row opened; supersession sets `validTo` + archives; confidence update via consolidation; `believedAt` before/after a change; `{ known: false }` distinct from low-confidence |
| Entities | alias resolution; deterministic-key match; sub-threshold similarity → new entity + `candidate_merge`; merge with redirect, no hard delete |
| Observations | observation does **not** auto-promote; N corroborating observations above threshold → promotion proposal; unpromoted observation expires on window |
| Causal | cognition proposal cannot write above `hypothesised_cause`; `established_cause` only via assertion/derivation; query returns `relationKind` verbatim |
| Memory candidates | scorer component breakdown persisted; duplicate → `merged`; low novelty → `rejected`; sensitive → capped / deferred |
| Consolidation | dedup merges episodes; durable pattern → semantic row; stale uncorroborated fact decays below floor → `expired`; insight with no evidence chain rejected; zero-insight run is valid |
| Retrieval ranking | recall is `top-k` + floor bounded; high similarity + low every-other-factor does **not** rank first; `principalId` scope enforced in-query |
| Privacy / forgetting | `RESTRICTED` row excluded from a non-local `ContextFrame`; `forget()` removes rows + evidence + writes contentless tombstone; ledger events untouched; cascade to derived semantic rows |
| Historical queries | `changedBetween(deployTime, now)`; `history()` full chain incl. archived |
| Procedural memory | procedure stored as ordered steps; version bump on update; `lastValidatedAt` set |
| Entity merge | alias + evidence preserved across merge; downstream fact/relationship references redirect |
| Boundary review | ATLAS service has no `projections.*` credential; MNEMOSYNE has no `atlas.*` credential; only Knowledge Ingestion writes either schema; per-schema DB roles reject cross-schema `SELECT`; a "conversation happened" input yields exactly one episode + zero-or-more derived facts citing it, never duplicated content |

---

## 11. Open risks (tracked, not blocking)

- **Consolidation without a model** (pre-MK.45) can only do deterministic
  compression/decay/dedup; genuine insight generation is thin until the Agent
  Runtime lands. Accepted: the pipeline, provenance discipline, and surfacing
  gate are what this phase proves.
- **Scoring-weight tuning** (candidate score, recall relevance) has no ground
  truth yet. Mitigated: weights are config, breakdowns are logged, defaults are
  conservative (favour recall precision / candidate rejection).
- **Entity-resolution false merges.** Mitigated: below-threshold ⇒ new entity +
  `candidate_merge` event for review, never a guessed merge (`WORLD_MODEL.md` §7).
- **pgvector recall quality at growth.** Mitigated per ADR-0011: recall is behind
  `MemoryRecall`; swapping in a dedicated engine is an adapter + sync path, not a
  schema redesign.
