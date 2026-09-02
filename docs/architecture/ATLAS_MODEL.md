# ATLAS — The Temporal World Model

The current, structured, provenance-bearing model of the world. Answers "what is
true now, and why" (L8, L11–L17). Phase: MK.46. Subordinate to
[`PRINCIPLES.md`](PRINCIPLES.md); governed by
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md),
[ADR-0021](adr/0021-causal-hypothesis-model.md).

Distinct from MNEMOSYNE ([`MNEMOSYNE_MODEL.md`](MNEMOSYNE_MODEL.md)) and from the
Kernel State Manager ([`STATE_MODEL.md`](STATE_MODEL.md)). Written only by the
Kernel Knowledge Ingestion mediator.

---

## 1 What it holds

ATLAS is the temporal world model subsystem — package `packages/world-model`,
schema `atlas`. It holds JARVIS's current beliefs about the world and the
evidence for each: entities, their relationships, and their attributes, across
every domain, each carrying provenance, confidence, epistemic status, and
temporal validity.

Domains modelled:

- **People** — the principal, colleagues, contacts.
- **Locations** — rooms, buildings, sites; each may carry spatial extent
  (`packages/spatial`).
- **Projects** — including status, participants, artefacts.
- **Devices / nodes** — the physical and virtual machines JARVIS runs on or
  talks to.
- **Software / infrastructure** — repositories, services, deployments,
  environments.
- **Businesses** — **ScaleSmiths is a first-class business domain**: the business
  entity, its projects, its infrastructure, its people, its software, its
  external accounts. JARVIS models it and operates on its behalf through
  `capabilities/scalesmiths`.
- **Digital context objects** — applications, windows, documents currently
  relevant (short-lived entities, mostly attribute churn).

### 1.1 Entity type vocabulary

A documented enum, but still an **open set** — new types are data, not code:

`person`, `organisation`, `business`, `project`, `device`, `node`, `location`,
`room`, `repository`, `software`, `service`, `document`, `infrastructure`,
`account`, `objective`, `asset`, `physical_object`, `concept`, `event`,
`app_window`.

**Reference-shell entities.** `objective`, `node`, and `device` entities are
identity nodes only — the authoritative record lives in `projections.objectives`
/ `projections.nodes`. ATLAS holds the shell so facts and relationships can point
at it; ATLAS never writes the projection.

### 1.2 Naming

`ATLAS` (capitalised) is the subsystem. `agents/atlas` (data analysis) is an
unchanged disposable worker — the Glossary disambiguates subsystem vs agent, as
it already does for `JarvisMode.FOCUSED` vs `PresenceState.FOCUSED`.

## 2 Schema (`atlas.*`)

### 2.1 Entities

| Field | Notes |
|---|---|
| `id` | ULID, stable |
| `type` | from the §1.1 vocabulary |
| `canonicalName` | string |
| `aliases` | stored as rows in the `atlas.entity_aliases` child table, assembled into `Entity.aliases[]` on read — new vs the MK.43 contract |
| `metadata` | `jsonb` — new |
| `privacyClass` | `PUBLIC \| INTERNAL \| SENSITIVE \| RESTRICTED` (reuses the event-envelope enum) — new |
| `principalId` | scoping key (L34) |
| `spatialExtent` | optional Scene Graph reference (existing) |
| `createdAt`, `updatedAt` | existing |

`atlas.entity_aliases` carries alias rows preserved across merges. Alias lookups
MUST join `atlas.entities` for `principalId` scoping — `entity_aliases` has no
`principalId` column (it is a pure child table with `on delete cascade`).

### 2.2 Relationships (first-class, temporal)

`atlas.entity_relationships`:

| Field | Notes |
|---|---|
| `id`, `fromEntityId`, `toEntityId`, `type` | existing; `type` is an open vocabulary (`founded`, `serves`, `uses`, `located_in`, `hosts`, `deployed_to`, `belongs_to`, `currently_in`, `owns`, `member_of`, `depends_on`, …) |
| `provenance`, `confidence` | existing, mandatory |
| `validFrom`, `validTo` | existing — relationships are **not** eternally true |
| `observedAt` | new — when the supporting evidence was seen, distinct from when the relationship became true |
| evidence | via the shared `evidence` table, `subjectKind` discriminator |

Relationship queries are always time-scoped, mirroring the fact query API.

### 2.3 Facts

`atlas.facts`:

| Field | Notes |
|---|---|
| `id`, `subjectEntityId` | existing |
| `attribute` | existing key form |
| `predicate` | new — subject-predicate-object form alongside `attribute`; a fact is never merely `key = value` |
| `value` | existing, JSON-serialisable |
| `factType` | **documented as ≡ `epistemicStatus`** — the six values ARE the fact types: `observed \| asserted \| retrieved \| inferred \| predicted \| derived`. It is not a separate field; JARVIS treats these six as meaning different things (authority ranking, §5). |
| `epistemicStatus` | existing, mandatory, never defaulted (L14) |
| `provenance` | existing, mandatory (L11) |
| `confidence` | existing, mandatory 0..1 (L12) |
| `validFrom`, `validTo` | existing (L13) |
| `status` | new — `active \| superseded \| retracted \| expired` |
| `supersedesFactId` | existing |
| `contradictionOf` | new — `ulid[]` explicit links, complementing the `conflicts` table |
| `createdAt`, `supersededAt` | `supersededAt` new, for `changedBetween` queries |

`atlas.facts_archive` — a plain table of the same shape. A background job
`insert … delete`s superseded / expired rows into it, out of the hot query path;
the evidence graph is retained. No declarative partitioning — bounded moves at
human-scale volume, per the events-table precedent in `migrator.ts`.

Only `status = 'active'` rows are storable in `atlas.facts` (enforced by
`facts_status_active_ck`); the archival job `insert … delete`s into
`atlas.facts_archive` rather than `update`-ing status in place.

### 2.4 Evidence

`atlas.evidence` — shared across facts, relationships, and observations via a
`subjectKind` discriminator:

| Field | Notes |
|---|---|
| `id` | ULID |
| `subjectKind`, `subjectId` | what the evidence supports (`fact \| relationship \| causal_hypothesis`) |
| `kind` | `observation \| source_document \| parent_fact \| principal_assertion \| inference_run \| episode` (matches the `atlas.evidence.kind` CHECK exactly) |
| `ref` | signal-event id \| url \| fact id \| session/episode id \| run id |
| `weight` | optional contribution weight |
| `note` | optional |
| `principalId` | scoping key (L34); `atlas.evidence.principal_id` is `not null` |

`kind = 'episode'` (with `ref` an `episodeId`) is the only legal ATLAS -> MNEMOSYNE
coupling (ADR-0020 point 2); content is never copied.

### 2.5 Conflicts

`atlas.conflicts` — `id`, `attribute`, `subjectEntityId`, `factIdA`, `factIdB`,
`status` (`open \| resolved_by_recency \| resolved_by_authority \|
resolved_by_principal \| accepted_ambiguity`), `recordedAt`.

### 2.6 Observations

`atlas.observations` — an index into expiring signal events:

| Field | Notes |
|---|---|
| `id`, `eventId`, `kind`, `summary`, `observedAt` | existing |
| `source` | producing component / sensor |
| `confidence` | 0..1 |
| `location` | `{ spaceId, ref? }` |
| `rawRef` | evidence-artifact blob reference (object storage) |
| `expiresAt` | rolling window; unpromoted observations are dropped |
| `promotedToFactId` | existing |

### 2.7 Causal hypotheses

`atlas.causal_hypotheses` — see §7.

All tables carry `principalId` (L34); pgvector columns + HNSW indexes support
entity resolution and recall; `facts` is a plain table holding only
`status = 'active'` rows, with a background job moving the rest into
`facts_archive` (§2.3); the schema has its own per-schema DB role.

## 3 Provenance, confidence, epistemic status (L11–L17)

- **Provenance** (`packages/contracts/src/provenance.ts`) records *how* the
  system came to hold this: producing component, node, method
  (`sensor \| model \| retrieval \| inference \| assertion \| derivation`), model
  id + version if applicable, source refs, and the `correlationId` of the run
  that produced it. **Non-optional** — the ingestion mediator rejects a fact
  without it.
- **Confidence** is a mandatory 0..1 scalar. Producers must estimate it;
  "unknown" is not a value. Derivation functions compute confidence from parents
  (documented per function).
- **Epistemic status** is mandatory and one of the six (`GLOSSARY.md`). It is
  never defaulted — the producer classifies. `factType` is the same field under
  another name; there is no independent `factType` column.
- **Untrusted-derived facts.** A fact whose evidence chain includes untrusted web
  content or unvalidated external data is stored with
  `provenance.derivedFromUntrusted = true` (review §16.8). Such a fact alone
  cannot justify any action above `riskClass: LOW`.
- **"I don't know" is a real answer** (L17). A query returns `{ known: false }`
  when no non-archived fact exists — distinct from
  `{ known: true, confidence: 0.2, value: … }`.

## 4 Ingestion

ATLAS is written **only** by the Kernel **Knowledge Ingestion** mediator — a
Kernel-internal protected service holding exactly the status the Capability
Executor holds: named and protected in the Kernel Constitution, but **not** a
17th entry in the frozen 16 (Executor-class internal service). Rationale:
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md).

Perception, cognition, agents, and interfaces never write `atlas.*`. They emit
observations, validated proposals, or principal-assertion commands. The mediator
centralises: provenance stamping (L11), untrusted tagging, `privacyClass`
assignment, entity resolution (once), dedupe / supersession / conflict decision,
and event emission after write.

Deterministic routing (ATLAS-relevant rows):

| Incoming | ATLAS gets |
|---|---|
| Perception observation | observation-index row (+ promotion candidacy) |
| Proposal: extracted fact about an entity | fact + evidence |
| Proposal carrying both a belief and an experience | derived fact citing the MNEMOSYNE episode id (content never copied) |
| Principal assertion (Command) | fact, `epistemicStatus: asserted`, `evidence.kind: principal_assertion` |
| DREAMING insight proposal | fact / hypothesis, `epistemicStatus: inferred`/`derived`, evidence → episodes/events |

Every write is a **separate record**. On write, ATLAS emits `jarvis.world.*`
(`fact.asserted`, `fact.superseded`, `conflict.recorded`, `entity.merged`,
`causal.hypothesised`, `record.forgotten`).

### 4.1 Entity resolution

- Deterministic keys first (email, repository URL, node id, canonical project
  slug).
- Then similarity (pgvector over name + salient attributes) with a threshold;
  below threshold ⇒ create a new entity and emit
  `jarvis.world.entity.candidate_merge` for later review rather than guessing.
- Merges are events (`jarvis.world.entity.merged`) with a redirect record;
  nothing is hard-deleted; aliases and evidence are preserved and downstream
  fact/relationship references redirect.

## 5 Belief revision (L16)

Carried over unchanged from the GENESIS World Model sketch:

- **Supersession** — a newer, more authoritative fact for the same
  `(entity, attribute)` sets `supersedesFactId` on itself and `validTo = now` on
  the old one; the old fact is archived after `validTo` passes.
- **Conflict, not overwrite** — disagreeing facts with no clear authority both
  persist; a `conflicts` row opens; cognition sees both with confidences; a
  principal assertion resolves it (`resolved_by_principal`).
- **Authority ranking** for automatic resolution: `asserted` (principal) >
  `observed` > `retrieved` (trusted) > `derived` > `inferred` > `predicted`;
  ties break by recency; still-ambiguous ⇒ leave `open`.
- Nothing is silently deleted. Belief history is reconstructable from `facts` +
  `facts_archive` + `events`.

## 6 Observation layer & promotion

`atlas.observations` indexes expiring signal events. **Promotion is not automatic
on arrival.** A scheduled promotion evaluator aggregates corroborating
observations; above a confidence / corroboration threshold it emits a
**proposal** to Knowledge Ingestion to write a fact.

"ARGUS saw a person-shaped object in the office" contributes evidence weight
toward "Rhys is in the office"; it is not that fact. Not all observations become
facts; unpromoted observations are dropped when their window passes.

## 7 Causal hypotheses (foundations only)

`atlas.causal_hypotheses`:

| Field | Notes |
|---|---|
| `id` | ULID |
| `causeRef`, `effectRef` | each an entity / fact / event id |
| `relationKind` | `chronological \| correlated \| hypothesised_cause \| established_cause` |
| `confidence` | 0..1 |
| `evidence` | `ulid[]` supporting refs |
| `method` | how it was derived |
| `validFrom`, `validTo`, `status` | temporal + lifecycle |

The enum **is** the safeguard. The ladder is ordered
`chronological` < `correlated` < `hypothesised_cause` < `established_cause`.
Nothing writes `established_cause` except an explicit principal assertion or a
deterministic derivation with named rule support. **Cognition proposals may reach
at most `hypothesised_cause`.** The query API returns `relationKind` verbatim so
no consumer can present a hypothesis as a proven cause. No causal-inference
engine ships this phase — only the typed store and the write discipline.
Rationale: [ADR-0021](adr/0021-causal-hypothesis-model.md).

## 8 Temporal query API

The `AtlasQuery` service interface (`packages/contracts/src/atlas-query.ts`).
Every method can return `{ known: false }` as a real result (L17), distinct from
a low-confidence hit.

| Method | Answers |
|---|---|
| `currentlyBelieved(entity, attribute?)` | "What is true now?" — `validFrom <= now < validTo`, ranked by confidence |
| `believedAt(entity, attribute?, t)` | "What was true yesterday?" — time-travelled, includes `facts_archive` |
| `changedBetween(t1, t2, filter?)` | "What changed today / this week / after deployment X?" — facts whose `validFrom`, `validTo`, or `supersededAt` is in the window (caller supplies the deployment boundary) |
| `history(entity, attribute)` | "When did relationship Y begin? What did we previously believe?" — full ordered chain incl. superseded |
| `evidenceFor(factId)` | "What evidence supports this?" — the evidence subgraph |
| `relationships(entity, at?, kinds?)` | time-scoped relationship neighbourhood |
| `causal(ref, direction)` | causal hypotheses touching a node; `relationKind` returned verbatim |

Retrieval stays per-subsystem: `AtlasQuery` never calls `MemoryRecall`. Only the
Context Compiler (frozen-16 component #5) fuses ATLAS facts and MNEMOSYNE
episodes into its budgeted `ContextFrame`; `ContextFrame.freshness` carries
`atlasAsOf`.

## 9 What ATLAS must never do

- Store conversation transcripts or episodic narrative — that is MNEMOSYNE
  (review §16.1). It may store a **derived fact** extracted from a conversation,
  with `evidence.kind = principal_assertion` or `inference_run` pointing at the
  MNEMOSYNE episode id. The episode text is never duplicated into ATLAS.
- Accept a fact without provenance, confidence, or epistemic status.
- Resolve a conflict by silent overwrite.
- Write `projections.*` or any frozen-16 component's schema. "JARVIS's objective
  is active" is a projection, not an ATLAS fact.
- Be written by anything other than the Knowledge Ingestion mediator.
- Grow without bound — superseded / expired facts are archived
  ([`STATE_MODEL.md`](STATE_MODEL.md) §6).
- Present a causal hypothesis as an established cause.

## 10 Consistency

- **Strong**: entity identity, entity type, relationship existence.
- **Eventual**: fact attributes, evidence graph, entity-resolution similarity
  links. `ContextFrame`s carry a freshness hint so cognition knows ATLAS may be
  seconds behind the latest observation.

## 11 What ATLAS is not

Two of the five boundary-proof points from the design spec (all five are in
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md)):

1. **World model ≠ State Manager.** ATLAS holds beliefs about the world
   (`atlas.facts`, provenance / confidence / temporal validity). The State
   Manager holds system state (`projections.*`: objective status, grants, mode).
   Different schemas, owners, and question. No write path exists from ATLAS to
   `projections.*`. ADR-0017 already forbids the overlap; this design adds no
   violating path.
2. **Vector store ≠ source of truth.** pgvector columns are similarity indexes
   only (ADR-0011). Retrieval ranking uses similarity as **one bounded factor**;
   no query returns truth because cosine distance was small. Contradiction
   resolution never consults embeddings.
