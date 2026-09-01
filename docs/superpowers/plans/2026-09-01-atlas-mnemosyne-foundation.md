# ATLAS + MNEMOSYNE Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the reviewable, inert foundation for the MK.46 Knowledge phase — the TypeScript contracts, PostgreSQL schemas, ADRs, and architecture docs for ATLAS (temporal world model) and MNEMOSYNE (memory) — with no service logic, so the subsequent service plans have a fixed target.

**Architecture:** Two peer protected subsystems (`packages/world-model` = ATLAS, schema `atlas`; `packages/memory` = MNEMOSYNE, schema `mnemosyne`), written only by a future Kernel-internal Knowledge Ingestion mediator. This plan adds only *declarations*: contract types, `event-names` constants, two forward-only SQL migrations, four ADRs, two model docs, doc updates, two diagrams, and one integration test proving the migrations apply cleanly with the right schemas, tables, roles, and extension.

**Tech Stack:** TypeScript 5.6 (strict, `verbatimModuleSyntax`, `.ts` import extensions), Node 22, pnpm workspaces, `postgres` (postgres.js) + hand-rolled forward-only SQL migrator, `pgvector/pgvector:pg16`, Vitest, `zod` (already a dep of `@jarvis/validation`; not used in this plan). No NestJS (MK.43 deviation). Lint = `tsc` strict + `scripts/lint.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-01-atlas-mnemosyne-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- **Subordinate to `docs/architecture/PRINCIPLES.md` (the 40 laws).** A contradiction with a law is a bug in this plan. Relevant: L5, L8, L11–L17, L34, ADR-0017.
- **Contracts evolve additively only.** `packages/contracts` is the leaf of the dependency graph (ADR-0007). New fields on existing interfaces must be optional *unless* the field is genuinely always-present for every producer (document which and why in the file header). Breaking changes require an ADR.
- **No runtime behaviour in `packages/contracts`** beyond `as const` lookup tables — types and trivial constant objects only (see `event-names.ts`).
- **`.ts` extension on every relative import.** `import type { Ulid } from './common.ts';` — never extensionless. `verbatimModuleSyntax` means `import type` for type-only imports.
- **Migrations are forward-only plain `.sql`**, applied in filename order by `packages/persistence/src/migrator.ts`, tracked in `public._migrations`, each wrapped in one transaction by the runner. Never edit an applied migration; add a new one.
- **`create schema if not exists` / `create ... if not exists` in every migration** so it is self-sufficient for throwaway test containers (pattern: `0001_schemas.sql`).
- **`principal_id text not null` on every ATLAS and MNEMOSYNE table** (L34). MK.42 has one principal; the column, indexes, and predicates exist now.
- **`privacy_class` values are exactly** `PUBLIC | INTERNAL | SENSITIVE | RESTRICTED` (the event-envelope enum — reuse, do not redefine).
- **`epistemicStatus` values are exactly** `observed | asserted | retrieved | inferred | predicted | derived` (from `packages/contracts/src/provenance.ts` — import `EpistemicStatus`, do not redefine).
- **Schema names are `atlas` and `mnemosyne`** — NOT the `world_model` / `memory` names in the older `WORLD_MODEL.md` sketch and `infrastructure/postgres/README.md`. ADR-0020 records the rename; Task 18 updates the stale references.
- **Lint bans** (`scripts/lint.mjs`): `console.log`, `@ts-ignore`, `as any`, bare `TODO` (write `TODO:` with detail or omit). `.test.ts` and `-cli.ts` files are exempt from the `console` ban only.
- **Verification gate after every task:** `pnpm typecheck` (0 errors) and `pnpm lint` (clean). Tasks that add runtime constants or the migration test also run `pnpm test`.
- **Not a git repository.** The "Commit" step in each task is: run the verification gate and stage the change mentally as one reviewable unit. If `git init` has happened by execution time, commit normally with the message shown.

---

## File Structure

**New contract files** (`packages/contracts/src/`):

| File | Responsibility |
|---|---|
| `causal.ts` | `CausalHypothesis`, `RelationKind` — ATLAS causal-hypothesis foundations |
| `memory.ts` | `Episode`, `SemanticMemory`, `Procedure`, `Preference`, `MemoryClass` — MNEMOSYNE durable classes |
| `memory-candidate.ts` | `MemoryCandidate`, `CandidateScore`, `CandidateDisposition` — the candidate pipeline record |
| `memory-insight.ts` | `Insight`, `InsightSignificance` — the morning-insight record |
| `knowledge-ingestion.ts` | `IngestionItem` union, `IngestionKind`, `RoutingDecision`, `KnowledgeIngestion` port |
| `atlas-query.ts` | `AtlasQuery` read service interface + its result types |
| `memory-recall.ts` | `MemoryRecall` read service interface + its result types |

**Modified contract files:**

| File | Change |
|---|---|
| `entity.ts` | Entity gains `aliases`, `metadata`, `privacyClass`; `EntityRelationship` gains `observedAt`; document the canonical `EntityType` vocabulary |
| `fact.ts` | `Fact` gains `predicate`, `status`, `contradictionOf`, `supersededAt`; add `FactStatus`; document `factType ≡ epistemicStatus` |
| `observation.ts` | Add a persisted `AtlasObservation` shape (`source`, `location`, `rawRef`, `expiresAt`, `promotedToFactId`) distinct from the perception-wire `Observation` |
| `event-names.ts` | Add `jarvis.world.*` and `jarvis.memory.*` constants |
| `index.ts` | Barrel-export the seven new files |

**New migrations** (`packages/persistence/src/migrations/`):

| File | Responsibility |
|---|---|
| `0005_atlas.sql` | `atlas` schema: `entities`, `entity_aliases`, `entity_relationships`, `facts`, `facts_archive`, `evidence`, `conflicts`, `observations`, `causal_hypotheses`; indexes; `jarvis_atlas` role |
| `0006_mnemosyne.sql` | `mnemosyne` schema: `episodes`, `semantic`, `procedures`, `preferences`, `candidates`, `consolidation_runs`, `insights`; indexes; `jarvis_mnemosyne` role |

**New test** (`apps/core/test/`):

| File | Responsibility |
|---|---|
| `knowledge-schema.integration.test.ts` | Runs all migrations against an ephemeral PG; asserts `atlas` + `mnemosyne` schemas, every table, both roles with correct grants, and the `vector` extension exist |

**New docs:**

| File | Responsibility |
|---|---|
| `docs/architecture/ATLAS_MODEL.md` | Full ATLAS model (supersedes the `WORLD_MODEL.md` sketch) |
| `docs/architecture/MNEMOSYNE_MODEL.md` | Full MNEMOSYNE model (supersedes the `STATE_MODEL.md` §Memory sketch) |
| `docs/architecture/adr/0020-knowledge-subsystem-boundary.md` | ATLAS/MNEMOSYNE peers; Knowledge Ingestion as an Executor-class internal service; the five-point no-duplicate-authority proof |
| `docs/architecture/adr/0021-causal-hypothesis-model.md` | The `RelationKind` ladder, write discipline, foundations-only |
| `docs/architecture/adr/0022-memory-consolidation.md` | DREAMING as a Scheduler routine emitting proposals only; evidence-mandatory insights |
| `docs/architecture/adr/0023-memory-retrieval-ranking.md` | Seven-factor weighted recall; similarity bounded; complements ADR-0011 |
| `docs/architecture/diagrams/atlas-ingestion.mmd` | Ingestion → route → ATLAS/MNEMOSYNE write |
| `docs/architecture/diagrams/mnemosyne-consolidation.mmd` | DREAMING pass → proposals → ingestion |

**Modified docs:** `WORLD_MODEL.md`, `STATE_MODEL.md`, `DATA_OWNERSHIP.md`, `GLOSSARY.md`, `KERNEL_CONSTITUTION.md`, `ROADMAP.md`, `infrastructure/postgres/README.md`, `docs/architecture/diagrams/README.md`, `docs/architecture/adr/README.md`.

---

## Task 1: Extend the Entity + EntityRelationship contracts

**Files:**
- Modify: `packages/contracts/src/entity.ts`

**Interfaces:**
- Consumes: `Confidence`, `PrincipalId`, `Timestamp`, `Ulid` from `./common.ts`; `Provenance` from `./provenance.ts`.
- Produces: `Entity` (+ `aliases: string[]`, `metadata: Record<string, unknown>`, `privacyClass: PrivacyClass`), `PrivacyClass`, `EntityType` (documented vocabulary), `EntityRelationship` (+ `observedAt: Timestamp`), `RelationshipType`.

- [ ] **Step 1: Rewrite `entity.ts` with the extended shapes**

```typescript
/**
 * ATLAS entities and relationships (docs/architecture/ATLAS_MODEL.md).
 *
 * Writers: the Kernel Knowledge Ingestion mediator ONLY. Never perception,
 * agents, or interfaces directly (SYSTEM_BOUNDARIES.md §7.1, ADR-0020).
 *
 * ADDITIVE CHANGE (MK.46): `aliases`, `metadata`, `privacyClass` on Entity and
 * `observedAt` on EntityRelationship. These are always-present for every
 * producer (Knowledge Ingestion fills defaults: `aliases: []`, `metadata: {}`,
 * `privacyClass: 'INTERNAL'`, `observedAt = provenance.producedAt`), so they are
 * required, not optional. Rationale: a partially-populated belief row is an
 * epistemics defect, not a valid state (L11).
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { Provenance } from './provenance.ts';

/** Confidentiality band. Identical set to the Event envelope's privacyClass. */
export type PrivacyClass = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';

/**
 * Canonical entity vocabulary (ATLAS_MODEL.md §Entities). Open set — a new
 * type is data, not code — but new values SHOULD be added here for discoverability.
 */
export type EntityType =
  | 'person'
  | 'organisation'
  | 'business' // ScaleSmiths is modelled here as a first-class business
  | 'project'
  | 'device'
  | 'node'
  | 'location'
  | 'room'
  | 'repository'
  | 'software'
  | 'service'
  | 'document'
  | 'infrastructure'
  | 'account'
  | 'objective' // reference shell; authoritative record is projections.objectives
  | 'asset'
  | 'physical_object'
  | 'concept'
  | 'event'
  | 'app_window'
  | (string & {}); // open set

export interface Entity {
  id: Ulid;
  type: EntityType;
  canonicalName: string;

  /** Assembled on read from atlas.entity_aliases. Empty array, never null. */
  aliases: string[];

  /** Free-form structured attributes that are not first-class Facts. */
  metadata: Record<string, unknown>;

  privacyClass: PrivacyClass;
  principalId: PrincipalId;

  /** Optional link into the Scene Graph coordinate hierarchy (ADR-0015). */
  spatialExtent?: {
    coordinateSpaceId: string;
    volume: unknown;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Relationship vocabulary (ATLAS_MODEL.md §Relationships). Open set. Examples:
 * founded, serves, uses, located_in, hosts, deployed_to, belongs_to,
 * currently_in, owns, member_of, depends_on, part_of, related_to.
 */
export type RelationshipType =
  | 'works_on'
  | 'located_in'
  | 'depends_on'
  | 'owns'
  | 'member_of'
  | 'part_of'
  | 'related_to'
  | 'founded'
  | 'serves'
  | 'uses'
  | 'hosts'
  | 'deployed_to'
  | 'belongs_to'
  | 'currently_in'
  | (string & {});

export interface EntityRelationship {
  id: Ulid;
  fromEntityId: Ulid;
  toEntityId: Ulid;
  type: RelationshipType;
  provenance: Provenance;
  confidence: Confidence;
  validFrom: Timestamp;
  /** null / undefined => still believed current. Relationships are NOT eternal. */
  validTo?: Timestamp;
  /** When the supporting evidence was seen — distinct from when it became true. */
  observedAt: Timestamp;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors. (If `context-frame.ts` or others referenced the old `Entity` shape without the new fields, they only *read* it — additive required fields on a type consumed by value in tests would surface here; there are no such consumers in MK.43, so this stays clean.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: `lint: clean`

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/entity.ts
git commit -m "feat(contracts): extend Entity/EntityRelationship for ATLAS (MK.46)"
```

---

## Task 2: Extend the Fact contract

**Files:**
- Modify: `packages/contracts/src/fact.ts`

**Interfaces:**
- Consumes: `Confidence`, `Timestamp`, `Ulid` from `./common.ts`; `EpistemicStatus`, `Provenance` from `./provenance.ts`; `PrivacyClass` from `./entity.ts`.
- Produces: `Fact` (+ `predicate?`, `status`, `contradictionOf`, `supersededAt?`, `privacyClass`), `FactStatus`, unchanged `Evidence`/`EvidenceKind`/`FactConflict`/`ConflictStatus`/`ScoredFact`.

- [ ] **Step 1: Edit `fact.ts` — add imports, `FactStatus`, and the new fields**

Add to the import block:

```typescript
import type { PrivacyClass } from './entity.ts';
```

Replace the file header comment's INVARIANTS list with:

```typescript
/**
 * Fact — a structured belief in ATLAS (docs/architecture/ATLAS_MODEL.md).
 *
 * `factType` is not a separate field: the six `epistemicStatus` values ARE the
 * fact types (observed / asserted / retrieved / inferred / predicted / derived).
 * JARVIS treats them as meaning different things — see the authority ranking in
 * ATLAS_MODEL.md §Belief revision.
 *
 * INVARIANTS (enforced by the ATLAS service, not the type system):
 *  - provenance mandatory (L11); confidence mandatory 0..1 (L12)
 *  - epistemicStatus mandatory, never defaulted (L14)
 *  - temporal validity via validFrom/validTo (L13)
 *  - contradictions RECORDED (conflicts + contradictionOf), never silently
 *    overwritten (L16)
 *  - a fact is never merely key=value: `predicate` carries the
 *    subject–predicate–object form when the statement is relational
 */
```

Add above `export interface Fact`:

```typescript
/** Lifecycle of a fact row. `active` is the only state in the hot `facts` table;
 *  the rest live in `facts_archive` (ATLAS_MODEL.md §Belief revision). */
export type FactStatus = 'active' | 'superseded' | 'retracted' | 'expired';
```

In `export interface Fact`, add these fields (keep the existing ones):

```typescript
  /** Subject–predicate–object form, when relational. Optional: attribute-only
   *  facts (`role`, `email`) leave this undefined. */
  predicate?: string;

  status: FactStatus;

  privacyClass: PrivacyClass;

  /** Explicit links to facts this one contradicts (complements the `conflicts`
   *  table with a direct edge). Empty array, never null. */
  contradictionOf: Ulid[];

  /** Set when status left `active`. Drives `changedBetween` queries. */
  supersededAt?: Timestamp;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: `lint: clean`

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/fact.ts
git commit -m "feat(contracts): extend Fact with status/predicate/contradictionOf (MK.46)"
```

---

## Task 3: Add the persisted AtlasObservation shape

**Files:**
- Modify: `packages/contracts/src/observation.ts`

**Interfaces:**
- Consumes: `NodeId`, `Timestamp`, `Ulid` from `./common.ts`.
- Produces: existing `Observation`/`ObservationDomain`/`ObservationRef` unchanged; new `AtlasObservation` (the row ATLAS stores as an index into an expiring signal event).

- [ ] **Step 1: Append `AtlasObservation` to `observation.ts`** (do not alter the existing `Observation` — that is the perception wire shape)

```typescript
/**
 * AtlasObservation — the row ATLAS keeps as a durable index into a (soon to
 * expire) perception signal event. Distinct from `Observation` above:
 * `Observation` is what perception emits; `AtlasObservation` is what the
 * Knowledge Ingestion mediator writes to `atlas.observations`.
 *
 * Not all observations become Facts. A scheduled promotion evaluator aggregates
 * corroborating rows and, above threshold, PROPOSES a fact — it never writes one
 * directly (ATLAS_MODEL.md §Observation layer).
 */
export interface AtlasObservation {
  id: Ulid;

  /** The perception signal event this indexes. May already be expired. */
  eventId: Ulid;

  kind: string;
  summary: string;

  /** Producing component / sensor id. */
  source: string;

  /** Node whose sensor produced the underlying signal. */
  node: NodeId;

  observedAt: Timestamp;
  confidence: number;

  location?: { spaceId: string; ref?: string };

  /** Object-storage reference to the evidence artifact (frame, clip), if any. */
  rawRef?: string;

  /** Rolling window. Unpromoted observations are dropped past this. */
  expiresAt: Timestamp;

  /** Set once the promotion evaluator's proposal produced a fact. */
  promotedToFactId?: Ulid;
}
```

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/observation.ts
git commit -m "feat(contracts): add AtlasObservation persisted shape (MK.46)"
```

---

## Task 4: New contract — `causal.ts`

**Files:**
- Create: `packages/contracts/src/causal.ts`

**Interfaces:**
- Consumes: `Confidence`, `PrincipalId`, `Timestamp`, `Ulid` from `./common.ts`.
- Produces: `RelationKind`, `CausalHypothesis`.

- [ ] **Step 1: Write `causal.ts`**

```typescript
/**
 * ATLAS causal-hypothesis foundations (docs/architecture/adr/0021-causal-hypothesis-model.md).
 *
 * FOUNDATIONS ONLY (MK.46): the typed store + the write discipline. No causal
 * inference engine ships this phase.
 *
 * The `RelationKind` ladder IS the safeguard against presenting correlation as
 * proven causation:
 *   - cognition proposals may reach at most `hypothesised_cause`
 *   - `established_cause` is writable ONLY by an explicit principal assertion or
 *     a deterministic derivation with named rule support
 *   - the query API returns `relationKind` verbatim so no consumer can mistake
 *     a hypothesis for a proven cause
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';

export type RelationKind =
  | 'chronological' // B happened after A; nothing more claimed
  | 'correlated' // A and B co-vary; no direction claimed
  | 'hypothesised_cause' // A may have caused B; evidence cited; not proven
  | 'established_cause'; // A caused B; assertion or rule-supported derivation only

export interface CausalHypothesis {
  id: Ulid;

  /** entity id | fact id | event id. */
  causeRef: string;
  /** entity id | fact id | event id. */
  effectRef: string;

  relationKind: RelationKind;
  confidence: Confidence;

  /** Supporting refs: event ids, fact ids, episode ids. */
  evidence: Ulid[];

  /** How this hypothesis was produced (free text: rule name, model run, assertion). */
  method: string;

  validFrom: Timestamp;
  validTo?: Timestamp;
  status: 'active' | 'retracted' | 'superseded';

  principalId: PrincipalId;
  createdAt: Timestamp;
}
```

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/causal.ts
git commit -m "feat(contracts): add CausalHypothesis / RelationKind (MK.46)"
```

---

## Task 5: New contract — `memory.ts`

**Files:**
- Create: `packages/contracts/src/memory.ts`

**Interfaces:**
- Consumes: `Confidence`, `PrincipalId`, `Timestamp`, `Ulid` from `./common.ts`; `Provenance` from `./provenance.ts`; `PrivacyClass` from `./entity.ts`.
- Produces: `MemoryClass`, `Episode`, `SemanticMemory`, `Procedure`, `ProcedureStep`, `Preference`.

- [ ] **Step 1: Write `memory.ts`**

```typescript
/**
 * MNEMOSYNE durable memory classes (docs/architecture/MNEMOSYNE_MODEL.md).
 *
 * Writers: the Kernel Knowledge Ingestion mediator ONLY.
 *
 * Five durable classes are schema-backed here. Three transient/borrowed classes
 * are NOT modelled as MNEMOSYNE records (MNEMOSYNE_MODEL.md §Classes):
 *   - working memory  -> Kernel Ephemeral store (Redis); MNEMOSYNE only reads it
 *   - session memory  -> a projection over session.* events
 *   - spatial memory  -> a reference to the Scene service; only `sceneRef` here
 * `entity memory` is a QUERY (episodes + semantic rows linked to an ATLAS
 * entity id), not a table.
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { PrivacyClass } from './entity.ts';

export type MemoryClass = 'episodic' | 'semantic' | 'procedural' | 'preference';

/** A bounded slice of experience. Narrative, lossy, decays. Never authoritative. */
export interface Episode {
  id: Ulid;
  kind: string; // "conversation" | "action_outcome" | "event_sequence" | "consolidation" | ...
  title: string;
  summary: string;

  /** Object-storage reference to the full body, if retained. */
  bodyRef?: string;

  occurredFrom: Timestamp;
  occurredTo: Timestamp;

  /** ATLAS entity ids involved. */
  participants: Ulid[];

  /** The events this episode was built from. */
  sourceEventIds: Ulid[];

  /** 0..1 importance estimate; drives retention and recall ranking. */
  salience: number;

  privacyClass: PrivacyClass;

  /** Reference into the Scene service, if the episode is spatially situated. */
  sceneRef?: string;

  principalId: PrincipalId;
  createdAt: Timestamp;

  /** Set when merged into another episode by consolidation. */
  supersededBy?: Ulid;
  archivedAt?: Timestamp;
}

/** A durable learned concept or knowledge statement. */
export interface SemanticMemory {
  id: Ulid;
  statement: string;
  confidence: Confidence;
  sourceEpisodeIds: Ulid[];
  privacyClass: PrivacyClass;
  /** relevance × age drives the prune-candidate score (MNEMOSYNE_MODEL.md §Forgetting). */
  relevance: number;
  principalId: PrincipalId;
  createdAt: Timestamp;
  lastReinforcedAt?: Timestamp;
}

export interface ProcedureStep {
  step: number;
  action: string;
  /** Optional reference to a verification/check for this step. */
  checkRef?: string;
}

/** A repeatable process, e.g. "Deploy ScaleSmiths". */
export interface Procedure {
  id: Ulid;
  name: string;
  steps: ProcedureStep[];
  version: number;
  sourceEpisodeIds: Ulid[];
  principalId: PrincipalId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastValidatedAt?: Timestamp;
}

/**
 * A non-sensitive interaction preference. `privacyClass` is capped at INTERNAL
 * by the MNEMOSYNE service — sensitive personal facts belong in ATLAS, not here.
 */
export interface Preference {
  id: Ulid;
  key: string; // "notification.style" | "editor" | "verbosity" | ...
  value: unknown;
  privacyClass: 'PUBLIC' | 'INTERNAL';
  confidence: Confidence;
  sourceEpisodeIds: Ulid[];
  principalId: PrincipalId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/memory.ts
git commit -m "feat(contracts): add MNEMOSYNE durable memory classes (MK.46)"
```

---

## Task 6: New contract — `memory-candidate.ts`

**Files:**
- Create: `packages/contracts/src/memory-candidate.ts`

**Interfaces:**
- Consumes: `PrincipalId`, `Timestamp`, `Ulid` from `./common.ts`.
- Produces: `CandidateDisposition`, `CandidateScore`, `MemoryCandidate`.

- [ ] **Step 1: Write `memory-candidate.ts`**

```typescript
/**
 * MNEMOSYNE memory-candidate pipeline (MNEMOSYNE_MODEL.md §Memory Candidate pipeline).
 *
 * Events tagged retentionClass MEMORY_CANDIDATE (plus session/objective
 * outcomes) land here first. Nothing becomes an Episode without passing this
 * gate. Not every conversation line is stored.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';

export type CandidateDisposition =
  | 'pending'
  | 'accepted'
  | 'merged'
  | 'rejected'
  | 'expired'
  | 'deferred';

/**
 * The scorer's component breakdown, persisted for audit and tuning
 * ("Why do you remember that?"). Each component is 0..1.
 */
export interface CandidateScore {
  novelty: number;
  importance: number;
  futureUtility: number;
  objectiveRelevance: number;
  confidence: number;
  /** Penalty component: 1 = fully duplicated, 0 = unique. */
  duplication: number;
  /** Penalty/defer component: 1 = highly sensitive. */
  sensitivity: number;
  durability: number;
  sourceQuality: number;
  /** The single weighted result the disposition threshold is applied to. */
  composite: number;
}

export interface MemoryCandidate {
  id: Ulid;
  sourceEventId: Ulid;
  sourceKind: string; // "event" | "session_outcome" | "objective_outcome"
  /** The raw material being scored (utterance, outcome summary, event payload slice). */
  content: unknown;
  score?: CandidateScore;
  disposition: CandidateDisposition;
  disposedAt?: Timestamp;
  /** Set when disposition = "merged" or "accepted". */
  episodeId?: Ulid;
  principalId: PrincipalId;
  createdAt: Timestamp;
}
```

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/memory-candidate.ts
git commit -m "feat(contracts): add MemoryCandidate pipeline types (MK.46)"
```

---

## Task 7: New contract — `memory-insight.ts`

**Files:**
- Create: `packages/contracts/src/memory-insight.ts`

**Interfaces:**
- Consumes: `PrincipalId`, `Timestamp`, `Ulid` from `./common.ts`.
- Produces: `InsightSignificance`, `Insight`.

- [ ] **Step 1: Write `memory-insight.ts`**

```typescript
/**
 * MNEMOSYNE morning-insight mechanism (MNEMOSYNE_MODEL.md §Morning Insight).
 *
 * Consolidation writes candidate insights. A surfacing check emits
 * `jarvis.memory.insight.available` ONLY when: significance >= threshold AND
 * relevant to a current objective/context AND not already surfaced AND
 * evidence-backed. The Notification Manager delivers it under its normal gate.
 * Zero insights on a run is the expected normal case — no insight is fabricated.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';

export type InsightSignificance = number; // 0..1

export interface Insight {
  id: Ulid;
  statement: string;
  significance: InsightSignificance;
  /** Supporting refs: episode ids, fact ids, event ids. Non-empty — an insight
   *  with no evidence chain is rejected at ingestion. */
  evidence: Ulid[];
  surfaced: boolean;
  surfacedAt?: Timestamp;
  supersededBy?: Ulid;
  consolidationRunId: Ulid;
  principalId: PrincipalId;
  createdAt: Timestamp;
}
```

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/memory-insight.ts
git commit -m "feat(contracts): add Insight type (MK.46)"
```

---

## Task 8: New contract — `knowledge-ingestion.ts`

**Files:**
- Create: `packages/contracts/src/knowledge-ingestion.ts`

**Interfaces:**
- Consumes: `CorrelationId`, `PrincipalId`, `Timestamp`, `Ulid` from `./common.ts`; `EpistemicStatus`, `Provenance` from `./provenance.ts`; `PrivacyClass` from `./entity.ts`.
- Produces: `IngestionKind`, `IngestionItem`, `RoutingTarget`, `RoutingDecision`, `IngestionResult`, `KnowledgeIngestion`.

- [ ] **Step 1: Write `knowledge-ingestion.ts`**

```typescript
/**
 * Knowledge Ingestion — the SINGLE write path into ATLAS (atlas.*) and
 * MNEMOSYNE (mnemosyne.*) (docs/architecture/adr/0020-knowledge-subsystem-boundary.md).
 *
 * Kernel-internal protected service, same status as the Capability Executor:
 * named and protected by the Kernel Constitution, NOT a 17th frozen component.
 * Perception, cognition, agents, and interfaces never write either schema —
 * they emit observations, validated proposals, or principal-assertion commands
 * that arrive here.
 *
 * This file is the PORT (interface) only. The implementation lands in a later
 * plan under apps/core/src/kernel/knowledge/.
 */

import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { EpistemicStatus, Provenance } from './provenance.ts';
import type { PrivacyClass } from './entity.ts';

export type IngestionKind =
  | 'perception_observation'
  | 'extracted_fact' // from a validated cognition proposal
  | 'episode' // a notable experience / action outcome
  | 'principal_assertion' // a Command from the Experience Plane
  | 'consolidation_output'; // a DREAMING proposal

/** One item offered to the mediator. The mediator — not the caller — decides
 *  routing, provenance stamping, privacy class, and entity resolution. */
export interface IngestionItem {
  kind: IngestionKind;
  correlationId: CorrelationId;
  principalId: PrincipalId;

  /** Caller-supplied provenance seed; the mediator completes/overrides it. */
  provenance: Provenance;

  /** Present for fact-bearing kinds. */
  fact?: {
    subjectRef: string; // entity id, or a resolvable descriptor
    attribute: string;
    predicate?: string;
    value: unknown;
    epistemicStatus: EpistemicStatus;
    confidence: number;
    validFrom?: Timestamp;
    validTo?: Timestamp;
    evidenceRefs: string[];
  };

  /** Present for kind = "episode" or when an item carries both a fact and its
   *  originating experience. */
  episode?: {
    kind: string;
    title: string;
    summary: string;
    occurredFrom: Timestamp;
    occurredTo: Timestamp;
    participantsRefs: string[];
    sourceEventIds: Ulid[];
    salienceHint?: number;
  };

  /** Present for kind = "perception_observation". */
  observation?: {
    eventId: Ulid;
    kind: string;
    summary: string;
    source: string;
    node: string;
    observedAt: Timestamp;
    confidence: number;
    expiresAt: Timestamp;
    rawRef?: string;
  };

  privacyHint?: PrivacyClass;
}

export type RoutingTarget = 'atlas' | 'mnemosyne';

export interface RoutingDecision {
  targets: RoutingTarget[];
  /** e.g. "extracted_fact -> atlas only"; "proposal carrying both -> atlas fact + mnemosyne episode". */
  rationale: string;
}

export interface IngestionResult {
  routed: RoutingDecision;
  atlasFactId?: Ulid;
  atlasObservationId?: Ulid;
  atlasCausalHypothesisId?: Ulid;
  mnemosyneEpisodeId?: Ulid;
  mnemosyneCandidateId?: Ulid;
  /** Conflict opened rather than overwrite (L16). */
  conflictId?: Ulid;
  emittedEventIds: Ulid[];
}

export interface KnowledgeIngestion {
  ingest(item: IngestionItem): Promise<IngestionResult>;
}
```

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/knowledge-ingestion.ts
git commit -m "feat(contracts): add KnowledgeIngestion port + IngestionItem (MK.46)"
```

---

## Task 9: New contracts — `atlas-query.ts` and `memory-recall.ts`

**Files:**
- Create: `packages/contracts/src/atlas-query.ts`
- Create: `packages/contracts/src/memory-recall.ts`

**Interfaces:**
- Consumes (`atlas-query.ts`): `Confidence`, `Known`, `Timestamp`, `Ulid` from `./common.ts`; `Fact` from `./fact.ts`; `EntityRelationship` from `./entity.ts`; `CausalHypothesis` from `./causal.ts`; `Evidence` from `./fact.ts`.
- Consumes (`memory-recall.ts`): `Timestamp`, `Ulid` from `./common.ts`; `Episode`, `SemanticMemory`, `Procedure`, `Preference`, `MemoryClass` from `./memory.ts`.
- Produces: `AtlasQuery`, `FactHistoryEntry`, `AtlasChange`; `MemoryRecall`, `RecalledItem`, `RecallQuery`, `RecallWeights`.

- [ ] **Step 1: Write `atlas-query.ts`**

```typescript
/**
 * ATLAS read service interface (docs/architecture/ATLAS_MODEL.md §Retrieval).
 * The Context Compiler and cognition query API bind to this. It NEVER calls
 * MemoryRecall — fusion happens only in the Context Compiler.
 *
 * Implementation lands in a later plan under packages/world-model/.
 */

import type { Confidence, Known, Timestamp, Ulid } from './common.ts';
import type { Fact, Evidence } from './fact.ts';
import type { EntityRelationship } from './entity.ts';
import type { CausalHypothesis } from './causal.ts';

export interface FactHistoryEntry {
  fact: Fact;
  supersededByFactId?: Ulid;
}

export interface AtlasChange {
  factId: Ulid;
  subjectEntityId: Ulid;
  attribute: string;
  changeKind: 'asserted' | 'superseded' | 'expired' | 'retracted';
  at: Timestamp;
}

export interface AtlasQuery {
  /** "What is true now?" — validFrom <= now < validTo, ranked by confidence. */
  currentlyBelieved(
    entityId: Ulid,
    attribute?: string,
  ): Promise<Known<{ facts: Fact[] }>>;

  /** "What was true at t?" — includes facts_archive. */
  believedAt(
    entityId: Ulid,
    attribute: string | undefined,
    t: Timestamp,
  ): Promise<Known<{ facts: Fact[] }>>;

  /** "What changed between t1 and t2?" — caller supplies the deployment boundary. */
  changedBetween(t1: Timestamp, t2: Timestamp, filter?: {
    entityId?: Ulid;
    attribute?: string;
  }): Promise<{ changes: AtlasChange[] }>;

  /** "When did belief Y begin? What did we previously believe?" */
  history(entityId: Ulid, attribute: string): Promise<{ chain: FactHistoryEntry[] }>;

  /** "What evidence supports this?" */
  evidenceFor(factId: Ulid): Promise<{ evidence: Evidence[] }>;

  /** Time-scoped relationship neighbourhood. */
  relationships(entityId: Ulid, opts?: {
    at?: Timestamp;
    kinds?: string[];
  }): Promise<{ relationships: EntityRelationship[] }>;

  /** Causal hypotheses touching a node; relationKind returned verbatim. */
  causal(ref: string, direction: 'cause' | 'effect' | 'both'): Promise<{
    hypotheses: CausalHypothesis[];
  }>;
}
```

- [ ] **Step 2: Write `memory-recall.ts`**

```typescript
/**
 * MNEMOSYNE read service interface (docs/architecture/MNEMOSYNE_MODEL.md §Retrieval,
 * docs/architecture/adr/0023-memory-retrieval-ranking.md).
 *
 * Recall is ALWAYS top-k + relevance floor — never "all relevant". The relevance
 * score is a seven-factor weighted composite; semantic similarity is ONE bounded
 * factor. Cosine similarity does not dictate truth.
 *
 * Implementation lands in a later plan under packages/memory/.
 */

import type { Timestamp, Ulid } from './common.ts';
import type {
  Episode,
  MemoryClass,
  Preference,
  Procedure,
  SemanticMemory,
} from './memory.ts';

/** Tunable weights, from config, logged with each recall (ADR-0023). `sim` is
 *  bounded so similarity alone cannot dominate. */
export interface RecallWeights {
  sim: number;
  entity: number;
  recency: number;
  importance: number;
  objective: number;
  confidence: number;
  sourceAuthority: number;
}

export interface RecallQuery {
  /** Natural-language or structured query text; the service embeds it. */
  text: string;
  /** ATLAS entity ids in scope, for the entity-overlap factor. */
  entityIds?: Ulid[];
  /** Active objective ids, for the objective-relevance factor. */
  objectiveIds?: Ulid[];
  classes?: MemoryClass[];
  principalId: string;
  k: number;
  /** Relevance floor; items below are not returned. */
  floor: number;
  asOf?: Timestamp;
}

export type RecalledItem =
  | { class: 'episodic'; item: Episode; relevance: number }
  | { class: 'semantic'; item: SemanticMemory; relevance: number }
  | { class: 'procedural'; item: Procedure; relevance: number }
  | { class: 'preference'; item: Preference; relevance: number };

export interface MemoryRecall {
  recall(query: RecallQuery): Promise<{
    items: RecalledItem[];
    weightsUsed: RecallWeights;
  }>;

  /** History associated with an ATLAS entity (a query, not a stored class). */
  entityMemory(entityId: Ulid, principalId: string, k: number): Promise<{
    items: RecalledItem[];
  }>;
}
```

- [ ] **Step 3: Typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors, `lint: clean`

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/atlas-query.ts packages/contracts/src/memory-recall.ts
git commit -m "feat(contracts): add AtlasQuery + MemoryRecall read interfaces (MK.46)"
```

---

## Task 10: Add event names and barrel exports

**Files:**
- Modify: `packages/contracts/src/event-names.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/event-names.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EventNames` gains `WorldFactAsserted`, `WorldFactSuperseded`, `WorldConflictRecorded`, `WorldEntityMerged`, `WorldForgotten`, `WorldCausalHypothesised`, `MemoryEpisodeRecorded`, `MemoryCandidateScored`, `MemoryCandidateDisposed`, `MemoryConsolidationCompleted`, `MemoryInsightAvailable`, `MemoryForgotten`. `index.ts` re-exports the seven new files.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/contracts/src/event-names.test.ts
import { describe, expect, it } from 'vitest';
import { EventNames } from './index.ts';

describe('MK.46 knowledge event names', () => {
  it('exposes jarvis.world.* names with the correct grammar', () => {
    expect(EventNames.WorldFactAsserted).toBe('jarvis.world.fact.asserted');
    expect(EventNames.WorldFactSuperseded).toBe('jarvis.world.fact.superseded');
    expect(EventNames.WorldConflictRecorded).toBe('jarvis.world.conflict.recorded');
    expect(EventNames.WorldEntityMerged).toBe('jarvis.world.entity.merged');
    expect(EventNames.WorldForgotten).toBe('jarvis.world.forgotten');
    expect(EventNames.WorldCausalHypothesised).toBe('jarvis.world.causal.hypothesised');
  });

  it('exposes jarvis.memory.* names with the correct grammar', () => {
    expect(EventNames.MemoryEpisodeRecorded).toBe('jarvis.memory.episode.recorded');
    expect(EventNames.MemoryCandidateScored).toBe('jarvis.memory.candidate.scored');
    expect(EventNames.MemoryCandidateDisposed).toBe('jarvis.memory.candidate.disposed');
    expect(EventNames.MemoryConsolidationCompleted).toBe('jarvis.memory.consolidation.completed');
    expect(EventNames.MemoryInsightAvailable).toBe('jarvis.memory.insight.available');
    expect(EventNames.MemoryForgotten).toBe('jarvis.memory.forgotten');
  });

  it('every name matches jarvis.<plane>.<domain>.<name>', () => {
    for (const v of Object.values(EventNames)) {
      expect(v).toMatch(/^jarvis\.[a-z]+\.[a-z_]+\.[a-z_]+$/);
    }
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run packages/contracts/src/event-names.test.ts`
Expected: FAIL — `EventNames.WorldFactAsserted` is `undefined`.

- [ ] **Step 3: Add the constants**

In `event-names.ts`, before the closing `} as const;`, add:

```typescript
  // --- World (ATLAS beliefs) — MK.46 ---
  WorldFactAsserted: 'jarvis.world.fact.asserted',
  WorldFactSuperseded: 'jarvis.world.fact.superseded',
  WorldConflictRecorded: 'jarvis.world.conflict.recorded',
  WorldEntityMerged: 'jarvis.world.entity.merged',
  WorldForgotten: 'jarvis.world.forgotten',
  WorldCausalHypothesised: 'jarvis.world.causal.hypothesised',

  // --- Memory (MNEMOSYNE experience) — MK.46 ---
  MemoryEpisodeRecorded: 'jarvis.memory.episode.recorded',
  MemoryCandidateScored: 'jarvis.memory.candidate.scored',
  MemoryCandidateDisposed: 'jarvis.memory.candidate.disposed',
  MemoryConsolidationCompleted: 'jarvis.memory.consolidation.completed',
  MemoryInsightAvailable: 'jarvis.memory.insight.available',
  MemoryForgotten: 'jarvis.memory.forgotten',
```

- [ ] **Step 4: Add barrel exports**

In `index.ts`, after `export * from './observation.ts';` add:

```typescript
export * from './causal.ts';
```

and after the `// --- Nervous System (MK.43) ---` block add:

```typescript

// --- Knowledge (MK.46) ---
export * from './memory.ts';
export * from './memory-candidate.ts';
export * from './memory-insight.ts';
export * from './knowledge-ingestion.ts';
export * from './atlas-query.ts';
export * from './memory-recall.ts';
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `pnpm vitest run packages/contracts/src/event-names.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/event-names.ts packages/contracts/src/index.ts packages/contracts/src/event-names.test.ts
git commit -m "feat(contracts): add jarvis.world.* / jarvis.memory.* event names + barrel exports (MK.46)"
```

---

## Task 11: Migration `0005_atlas.sql`

**Files:**
- Create: `packages/persistence/src/migrations/0005_atlas.sql`

**Interfaces:**
- Consumes: the `vector` extension (present in the `pgvector/pgvector:pg16` image and `00-init.sql`); `events` schema (migration `0001`).
- Produces: schema `atlas` with tables `entities`, `entity_aliases`, `entity_relationships`, `facts`, `facts_archive`, `evidence`, `conflicts`, `observations`, `causal_hypotheses`; role `jarvis_atlas`.

- [ ] **Step 1: Write `0005_atlas.sql`**

```sql
-- ATLAS — the temporal world model (docs/architecture/ATLAS_MODEL.md, ADR-0020).
-- Writers: the Kernel Knowledge Ingestion mediator ONLY.
-- Schema name is `atlas` (ADR-0020 renames the older `world_model` sketch).

create schema if not exists atlas;
create extension if not exists vector;

-- Entities ---------------------------------------------------------------------
create table if not exists atlas.entities (
  id             text        primary key,
  type           text        not null,
  canonical_name text        not null,
  metadata       jsonb       not null default '{}',
  privacy_class  text        not null default 'INTERNAL'
                   check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  principal_id   text        not null,
  spatial_extent jsonb,
  -- Entity-resolution embedding (ADR-0011). Dim is model-dependent; 1536 =
  -- text-embedding-3-small. Re-embed on model change (store the model id).
  embedding          vector(1536),
  embedding_model_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists entities_type_idx on atlas.entities (principal_id, type);
create index if not exists entities_name_idx on atlas.entities (principal_id, lower(canonical_name));
create index if not exists entities_embedding_idx
  on atlas.entities using hnsw (embedding vector_cosine_ops);

-- Normalised aliases (assembled into Entity.aliases[] on read; carries source). --
create table if not exists atlas.entity_aliases (
  entity_id  text        not null references atlas.entities(id) on delete cascade,
  alias      text        not null,
  source     text        not null default 'unknown',
  created_at timestamptz not null default now(),
  primary key (entity_id, alias)
);

-- Relationships (first-class, temporal) --------------------------------------- --
create table if not exists atlas.entity_relationships (
  id             text        primary key,
  from_entity_id text        not null references atlas.entities(id),
  to_entity_id   text        not null references atlas.entities(id),
  type           text        not null,
  provenance     jsonb       not null,
  confidence     double precision not null check (confidence >= 0 and confidence <= 1),
  valid_from     timestamptz not null default now(),
  valid_to       timestamptz,
  observed_at    timestamptz not null default now(),
  principal_id   text        not null,
  created_at     timestamptz not null default now()
);
create index if not exists rel_from_idx on atlas.entity_relationships (from_entity_id, type);
create index if not exists rel_to_idx   on atlas.entity_relationships (to_entity_id, type);
create index if not exists rel_valid_idx on atlas.entity_relationships (valid_from, valid_to);

-- Facts (hot: status = 'active' only) --------------------------------------- --
create table if not exists atlas.facts (
  id                 text        primary key,
  subject_entity_id  text        not null references atlas.entities(id),
  attribute          text        not null,
  predicate          text,
  value              jsonb       not null,
  epistemic_status   text        not null
                       check (epistemic_status in
                         ('observed','asserted','retrieved','inferred','predicted','derived')),
  provenance         jsonb       not null,
  confidence         double precision not null check (confidence >= 0 and confidence <= 1),
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz,
  status             text        not null default 'active'
                       check (status in ('active','superseded','retracted','expired')),
  supersedes_fact_id text,
  superseded_at      timestamptz,
  contradiction_of   text[]      not null default '{}',
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  constraint facts_status_active_ck check (status = 'active')
);
create index if not exists facts_subject_attr_idx
  on atlas.facts (subject_entity_id, attribute);
create index if not exists facts_valid_idx on atlas.facts (valid_from, valid_to);

-- Archive: same shape, status <> 'active'. A job moves rows here (no
-- declarative partitioning — bounded moves at human-scale volume, per the
-- events-table precedent in migrator.ts).
create table if not exists atlas.facts_archive (
  id                 text        primary key,
  subject_entity_id  text        not null,
  attribute          text        not null,
  predicate          text,
  value              jsonb       not null,
  epistemic_status   text        not null,
  provenance         jsonb       not null,
  confidence         double precision not null,
  valid_from         timestamptz not null,
  valid_to           timestamptz,
  status             text        not null
                       check (status in ('superseded','retracted','expired')),
  supersedes_fact_id text,
  superseded_at      timestamptz not null,
  contradiction_of   text[]      not null default '{}',
  privacy_class      text        not null,
  principal_id       text        not null,
  created_at         timestamptz not null,
  archived_at        timestamptz not null default now()
);
create index if not exists facts_archive_subject_idx
  on atlas.facts_archive (subject_entity_id, attribute, valid_from);

-- Evidence graph (facts AND relationships) --------------------------------- --
create table if not exists atlas.evidence (
  id           text        primary key,
  subject_kind text        not null check (subject_kind in ('fact','relationship','causal_hypothesis')),
  subject_id   text        not null,
  kind         text        not null
                 check (kind in ('observation','source_document','parent_fact',
                                 'principal_assertion','inference_run','episode')),
  ref          text        not null,
  weight       double precision,
  note         text,
  principal_id text        not null,
  created_at   timestamptz not null default now()
);
create index if not exists evidence_subject_idx on atlas.evidence (subject_kind, subject_id);

-- Conflicts (recorded, not resolved by overwrite — L16) ------------------- --
create table if not exists atlas.conflicts (
  id                text        primary key,
  subject_entity_id text        not null references atlas.entities(id),
  attribute         text        not null,
  fact_id_a         text        not null,
  fact_id_b         text        not null,
  status            text        not null default 'open'
                      check (status in ('open','resolved_by_recency','resolved_by_authority',
                                        'resolved_by_principal','accepted_ambiguity')),
  principal_id      text        not null,
  recorded_at       timestamptz not null default now()
);
create index if not exists conflicts_open_idx
  on atlas.conflicts (subject_entity_id, attribute) where status = 'open';

-- Observation index (raw signal events expire; this row persists) --------- --
create table if not exists atlas.observations (
  id                  text        primary key,
  event_id            text        not null,
  kind                text        not null,
  summary             text        not null,
  source              text        not null,
  node                text        not null,
  observed_at         timestamptz not null,
  confidence          double precision not null,
  location            jsonb,
  raw_ref             text,
  expires_at          timestamptz not null,
  promoted_to_fact_id text,
  principal_id        text        not null,
  created_at          timestamptz not null default now()
);
create index if not exists observations_expiry_idx on atlas.observations (expires_at)
  where promoted_to_fact_id is null;
create index if not exists observations_kind_idx on atlas.observations (kind, observed_at desc);

-- Causal hypotheses (foundations only — ADR-0021) ------------------------ --
create table if not exists atlas.causal_hypotheses (
  id            text        primary key,
  cause_ref     text        not null,
  effect_ref    text        not null,
  relation_kind text        not null
                  check (relation_kind in ('chronological','correlated',
                                           'hypothesised_cause','established_cause')),
  confidence    double precision not null check (confidence >= 0 and confidence <= 1),
  evidence      text[]      not null default '{}',
  method        text        not null,
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  status        text        not null default 'active'
                  check (status in ('active','retracted','superseded')),
  principal_id  text        not null,
  created_at    timestamptz not null default now()
);
create index if not exists causal_cause_idx  on atlas.causal_hypotheses (cause_ref);
create index if not exists causal_effect_idx on atlas.causal_hypotheses (effect_ref);

-- Per-schema role (boundary proof — ADR-0020 §5, DATA_OWNERSHIP.md §3).
-- Forward-looking: MK.43 still connects as one role; the service split binds to
-- this. Guarded create so the migration is idempotent across test containers.
do $$
begin
  if not exists (select from pg_roles where rolname = 'jarvis_atlas') then
    create role jarvis_atlas nologin;
  end if;
end
$$;
grant usage on schema atlas to jarvis_atlas;
grant select, insert, update, delete on all tables in schema atlas to jarvis_atlas;
alter default privileges in schema atlas
  grant select, insert, update, delete on tables to jarvis_atlas;
grant usage on schema events to jarvis_atlas;
grant select on events.events to jarvis_atlas;
```

- [ ] **Step 2: Sanity-check the SQL parses** (fast, no full test yet)

Run: `node -e "const s=require('fs').readFileSync('packages/persistence/src/migrations/0005_atlas.sql','utf8'); if(!/create schema if not exists atlas/.test(s)) throw new Error('missing schema stmt'); console.error('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add packages/persistence/src/migrations/0005_atlas.sql
git commit -m "feat(persistence): 0005 atlas schema (MK.46)"
```

---

## Task 12: Migration `0006_mnemosyne.sql`

**Files:**
- Create: `packages/persistence/src/migrations/0006_mnemosyne.sql`

**Interfaces:**
- Consumes: the `vector` extension; `events` schema.
- Produces: schema `mnemosyne` with tables `episodes`, `semantic`, `procedures`, `preferences`, `candidates`, `consolidation_runs`, `insights`; role `jarvis_mnemosyne`.

- [ ] **Step 1: Write `0006_mnemosyne.sql`**

```sql
-- MNEMOSYNE — memory (docs/architecture/MNEMOSYNE_MODEL.md, ADR-0020).
-- Writers: the Kernel Knowledge Ingestion mediator ONLY.
-- Schema name is `mnemosyne` (ADR-0020 renames the older `memory` sketch).
-- NOT authoritative truth. Append + summarise + decay.

create schema if not exists mnemosyne;
create extension if not exists vector;

-- Episodic ------------------------------------------------------------------- --
create table if not exists mnemosyne.episodes (
  id                 text        primary key,
  kind               text        not null,
  title              text        not null,
  summary            text        not null,
  body_ref           text,
  occurred_from      timestamptz not null,
  occurred_to        timestamptz not null,
  participants       text[]      not null default '{}',
  source_event_ids   text[]      not null default '{}',
  salience           double precision not null default 0
                       check (salience >= 0 and salience <= 1),
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  scene_ref          text,
  embedding          vector(1536),
  embedding_model_id text,
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  superseded_by      text,
  archived_at        timestamptz
);
create index if not exists episodes_recency_idx on mnemosyne.episodes (principal_id, occurred_to desc);
create index if not exists episodes_participants_idx on mnemosyne.episodes using gin (participants);
create index if not exists episodes_embedding_idx
  on mnemosyne.episodes using hnsw (embedding vector_cosine_ops);

-- Semantic ---------------------------------------------------------------- --
create table if not exists mnemosyne.semantic (
  id                 text        primary key,
  statement          text        not null,
  confidence         double precision not null check (confidence >= 0 and confidence <= 1),
  source_episode_ids text[]      not null default '{}',
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  relevance          double precision not null default 0.5,
  embedding          vector(1536),
  embedding_model_id text,
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  last_reinforced_at timestamptz
);
create index if not exists semantic_embedding_idx
  on mnemosyne.semantic using hnsw (embedding vector_cosine_ops);
create index if not exists semantic_prune_idx on mnemosyne.semantic (principal_id, relevance);

-- Procedural ------------------------------------------------------------ --
create table if not exists mnemosyne.procedures (
  id                 text        primary key,
  name               text        not null,
  steps              jsonb       not null,
  version            integer     not null default 1,
  source_episode_ids text[]      not null default '{}',
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_validated_at  timestamptz,
  unique (principal_id, name)
);

-- Preference (privacy capped at INTERNAL) ---------------------------- --
create table if not exists mnemosyne.preferences (
  id                 text        primary key,
  key                text        not null,
  value              jsonb       not null,
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL')),
  confidence         double precision not null check (confidence >= 0 and confidence <= 1),
  source_episode_ids text[]      not null default '{}',
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (principal_id, key)
);

-- Candidate pipeline ---------------------------------------------- --
create table if not exists mnemosyne.candidates (
  id              text        primary key,
  source_event_id text        not null,
  source_kind     text        not null,
  content         jsonb       not null,
  score           double precision,
  score_breakdown jsonb,
  disposition     text        not null default 'pending'
                    check (disposition in ('pending','accepted','merged','rejected','expired','deferred')),
  disposed_at     timestamptz,
  episode_id      text,
  principal_id    text        not null,
  created_at      timestamptz not null default now()
);
create index if not exists candidates_pending_idx on mnemosyne.candidates (created_at)
  where disposition = 'pending';

-- Consolidation run log ("DREAMING") ---------------------------- --
create table if not exists mnemosyne.consolidation_runs (
  id                text        primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  inputs_scanned    jsonb       not null default '{}',
  proposals_emitted integer     not null default 0,
  outcomes          jsonb       not null default '{}',
  principal_id      text        not null
);
create index if not exists consolidation_runs_recency_idx
  on mnemosyne.consolidation_runs (started_at desc);

-- Insights ------------------------------------------------------ --
create table if not exists mnemosyne.insights (
  id                   text        primary key,
  statement            text        not null,
  significance         double precision not null check (significance >= 0 and significance <= 1),
  evidence             text[]      not null,
  surfaced             boolean     not null default false,
  surfaced_at          timestamptz,
  superseded_by        text,
  consolidation_run_id text        not null,
  principal_id         text        not null,
  created_at           timestamptz not null default now(),
  constraint insights_evidence_nonempty_ck check (cardinality(evidence) > 0)
);
create index if not exists insights_unsurfaced_idx on mnemosyne.insights (significance desc)
  where surfaced = false;

-- Per-schema role (boundary proof — ADR-0020 §5).
do $$
begin
  if not exists (select from pg_roles where rolname = 'jarvis_mnemosyne') then
    create role jarvis_mnemosyne nologin;
  end if;
end
$$;
grant usage on schema mnemosyne to jarvis_mnemosyne;
grant select, insert, update, delete on all tables in schema mnemosyne to jarvis_mnemosyne;
alter default privileges in schema mnemosyne
  grant select, insert, update, delete on tables to jarvis_mnemosyne;
grant usage on schema events to jarvis_mnemosyne;
grant select on events.events to jarvis_mnemosyne;
-- Boundary: jarvis_mnemosyne is granted NOTHING on schema atlas, and vice versa.
```

- [ ] **Step 2: Sanity-check parses**

Run: `node -e "const s=require('fs').readFileSync('packages/persistence/src/migrations/0006_mnemosyne.sql','utf8'); if(!/insights_evidence_nonempty_ck/.test(s)) throw new Error('missing evidence check'); console.error('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add packages/persistence/src/migrations/0006_mnemosyne.sql
git commit -m "feat(persistence): 0006 mnemosyne schema (MK.46)"
```

---

## Task 13: Integration test — migrations apply, schema shape is correct

**Files:**
- Create: `apps/core/test/knowledge-schema.integration.test.ts`

**Interfaces:**
- Consumes: `startEphemeralPg`, `isDockerAvailable` from `@jarvis/testkit`; `createPg`, `runMigrations` from `@jarvis/persistence`.
- Produces: nothing (test only).

- [ ] **Step 1: Write the test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { isDockerAvailable, startEphemeralPg, type EphemeralPg } from '@jarvis/testkit';

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('MK.46 knowledge schema (integration)', () => {
  let container: EphemeralPg;
  let pg: PgHandle;

  beforeAll(async () => {
    container = await startEphemeralPg();
    pg = createPg({ url: container.url });
    await runMigrations(pg.sql);
  }, 120_000);

  afterAll(async () => {
    await pg?.close().catch(() => undefined);
    await container?.stop().catch(() => undefined);
  });

  it('creates the atlas and mnemosyne schemas', async () => {
    const rows = await pg.sql<{ schema_name: string }[]>`
      select schema_name from information_schema.schemata
      where schema_name in ('atlas','mnemosyne')`;
    expect(rows.map((r) => r.schema_name).sort()).toEqual(['atlas', 'mnemosyne']);
  });

  it('creates every ATLAS table', async () => {
    const rows = await pg.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'atlas'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'causal_hypotheses', 'conflicts', 'entities', 'entity_aliases',
      'entity_relationships', 'evidence', 'facts', 'facts_archive', 'observations',
    ]);
  });

  it('creates every MNEMOSYNE table', async () => {
    const rows = await pg.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'mnemosyne'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'candidates', 'consolidation_runs', 'episodes', 'insights',
      'preferences', 'procedures', 'semantic',
    ]);
  });

  it('has the vector extension available', async () => {
    const rows = await pg.sql<{ extname: string }[]>`
      select extname from pg_extension where extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('creates both per-schema roles', async () => {
    const rows = await pg.sql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname in ('jarvis_atlas','jarvis_mnemosyne')`;
    expect(rows.map((r) => r.rolname).sort()).toEqual(['jarvis_atlas', 'jarvis_mnemosyne']);
  });

  it('grants jarvis_atlas on atlas but NOT on mnemosyne (boundary proof)', async () => {
    const canAtlas = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_atlas', 'atlas', 'usage') as has`;
    const canMnemosyne = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_atlas', 'mnemosyne', 'usage') as has`;
    expect(canAtlas[0]?.has).toBe(true);
    expect(canMnemosyne[0]?.has).toBe(false);
  });

  it('grants jarvis_mnemosyne on mnemosyne but NOT on atlas (boundary proof)', async () => {
    const canMnemosyne = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_mnemosyne', 'mnemosyne', 'usage') as has`;
    const canAtlas = await pg.sql<{ has: boolean }[]>`
      select has_schema_privilege('jarvis_mnemosyne', 'atlas', 'usage') as has`;
    expect(canMnemosyne[0]?.has).toBe(true);
    expect(canAtlas[0]?.has).toBe(false);
  });

  it('re-running migrations is a no-op (idempotent)', async () => {
    const result = await runMigrations(pg.sql);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toContain('0005_atlas.sql');
    expect(result.alreadyApplied).toContain('0006_mnemosyne.sql');
  });

  it('rejects an insight row with empty evidence (evidence chain mandatory)', async () => {
    await expect(
      pg.sql`insert into mnemosyne.insights
        (id, statement, significance, evidence, consolidation_run_id, principal_id)
        values ('01TEST', 'x', 0.9, '{}', '01RUN', 'p1')`,
    ).rejects.toThrow(/insights_evidence_nonempty_ck/);
  });

  it('rejects a fact row with confidence outside 0..1', async () => {
    // entity FK first
    await pg.sql`insert into atlas.entities (id, type, canonical_name, principal_id)
                 values ('01ENT', 'person', 'Test', 'p1') on conflict do nothing`;
    await expect(
      pg.sql`insert into atlas.facts
        (id, subject_entity_id, attribute, value, epistemic_status, provenance, confidence, principal_id)
        values ('01F', '01ENT', 'role', '"x"', 'asserted', '{}', 1.5, 'p1')`,
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test:integration` (or `pnpm vitest run apps/core/test/knowledge-schema.integration.test.ts` if Docker is available directly)
Expected: PASS if Docker is available; SKIPPED otherwise (the `describe.skipIf`). If Docker is up, all 11 assertions pass.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, unit tests pass (the integration test self-skips under plain `pnpm test` unless `JARVIS_TEST_DB_URL` is set — mirrors existing `*.integration.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/core/test/knowledge-schema.integration.test.ts
git commit -m "test(core): 0005/0006 migrations apply with correct schema + boundary grants (MK.46)"
```

---

## Task 14: ADR-0020 — Knowledge subsystem boundary

**Files:**
- Create: `docs/architecture/adr/0020-knowledge-subsystem-boundary.md`
- Modify: `docs/architecture/adr/README.md` (add the row)

**Interfaces:** none (docs).

- [ ] **Step 1: Write the ADR** — follow the exact section order of `0019-operating-modes.md` (Context, Decision, Alternatives considered, Benefits, Disadvantages, Risks, Consequences, Reversal difficulty).

```markdown
# ADR-0020: Knowledge subsystem boundary — ATLAS and MNEMOSYNE

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context
MK.46 introduces the temporal world model (**ATLAS**) and memory (**MNEMOSYNE**).
L8 already mandates they be separate systems; ADR-0017 already forbids duplicated
authority. The risk this ADR closes: the two collapsing into one generic vector
store, or "memory" becoming a second State Manager. The brief also adds capability
beyond the GENESIS sketch — a causal-hypothesis layer, eight memory classes, a
candidate pipeline, scheduled consolidation, a morning-insight mechanism,
multi-factor retrieval — each a chance to blur the boundary.

## Decision
- **Two peer protected subsystems.** `packages/world-model` (ATLAS, schema
  `atlas`) and `packages/memory` (MNEMOSYNE, schema `mnemosyne`): separate
  schemas, separate read service interfaces (`AtlasQuery`, `MemoryRecall`),
  separate single owners. The schema rename from the older `world_model` /
  `memory` sketch names is recorded here.
- **One Knowledge Ingestion mediator** is the *only* writer to `atlas.*` and
  `mnemosyne.*`. It has the same status as the Capability Executor: named and
  protected by `KERNEL_CONSTITUTION.md`, but **not a 17th entry in the frozen
  16**. It stamps provenance, applies untrusted tagging, sets `privacyClass`,
  resolves entities once, and routes each input to ATLAS, MNEMOSYNE, or both —
  as **separate records with cross-links**, never duplicated content.
- **Consolidation ("DREAMING")** is a Scheduler routine that emits *proposals*
  back through Knowledge Ingestion; it never writes either schema directly.
- **Retrieval is per-subsystem.** Only the Context Compiler fuses ATLAS facts
  and MNEMOSYNE episodes, inside its existing budgeted `ContextFrame`.
- **Per-schema DB roles** (`jarvis_atlas`, `jarvis_mnemosyne`), each granted on
  its own schema plus `SELECT` on `events.events` and nothing else. MK.43 still
  connects as one role; the service split binds to these.

## Alternatives considered
- **Fully independent ingestion pipelines, no mediator.** Rejected: duplicates
  entity resolution, provenance stamping, untrusted tagging, and privacy
  classification across two codebases; the split of a single proposal ("Rhys
  said X in this chat") across both systems becomes uncoordinated, making the
  no-duplicate-authority proof harder, not easier.
- **One "Knowledge" subsystem with ATLAS/MNEMOSYNE as internal modules.**
  Rejected: directly contradicts L8 ("distinct packages, distinct schemas,
  distinct service APIs") and the core mandate that the two not collapse.
- **A dedicated graph database (Neo4j) for ATLAS.** Rejected per ADR-0011's
  reasoning: no benchmarked evidence PostgreSQL cannot serve MK.42 volumes;
  relational + recursive queries suffice; a second datastore is unjustified cost.

## Benefits
- One validation / provenance choke point (L11, L14 enforced in exactly one
  place).
- The "conversation happened -> derived fact + episode" split is coordinated in
  a single component.
- Extraction seam #1 (`SYSTEM_BOUNDARIES.md` §10) preserved: both lift out
  together as the knowledge service.
- No expansion of the frozen 16.

## Disadvantages
- Knowledge Ingestion is a new named internal service to justify and protect
  (this ADR is that justification).
- Every knowledge write goes through one component — a throughput chokepoint at
  large scale. Accepted: MK.42 volume is human-scale; the seam to extract it
  exists.

## Risks
- **Someone bypasses the mediator and writes `atlas.*` / `mnemosyne.*` from a
  projector or an agent.** Mitigated: per-schema roles; the boundary integration
  test asserts `jarvis_atlas` has no `mnemosyne` privilege and vice versa;
  `DATA_OWNERSHIP.md` §1 names Knowledge Ingestion as the sole writer.
- **MNEMOSYNE drifts into holding system state.** Mitigated: working/session/
  spatial memory are explicitly pointers to their existing Kernel owners
  (Ephemeral store, Session Manager, Scene service), not MNEMOSYNE tables.
- **ATLAS facts duplicate Projected State.** Mitigated: `objective`/`node`/
  `device` entities are reference shells; the authoritative record stays in
  `projections.*`; ATLAS has no write path there.

## Consequences
- `packages/contracts` gains `causal.ts`, `memory.ts`, `memory-candidate.ts`,
  `memory-insight.ts`, `knowledge-ingestion.ts`, `atlas-query.ts`,
  `memory-recall.ts`; `entity.ts` / `fact.ts` / `observation.ts` extended;
  `event-names.ts` gains `jarvis.world.*` and `jarvis.memory.*`.
- Migrations `0005_atlas.sql`, `0006_mnemosyne.sql`.
- `DATA_OWNERSHIP.md` §1 gains a row per new category, all owned by the ATLAS
  service or the MNEMOSYNE service, all written by Knowledge Ingestion.
- New model docs `ATLAS_MODEL.md`, `MNEMOSYNE_MODEL.md`; `WORLD_MODEL.md` and
  `STATE_MODEL.md` §Memory become pointers.
- `KERNEL_CONSTITUTION.md` gains one sentence naming Knowledge Ingestion as an
  Executor-class protected internal service.

## Boundary proof
1. **World Model != State Manager.** `atlas.facts` (beliefs, provenance,
   temporal validity) vs `projections.*` (system state). Different schemas,
   owners, question. No write path from ATLAS to `projections.*`.
2. **Memory != World Model.** Episodes (narrative, lossy, decaying) vs facts
   (structured, provenance-bound, revised not deleted). Only coupling: an ATLAS
   fact may cite a MNEMOSYNE episode id as evidence. Content never copied.
3. **Memory != event log.** The Event Log is authoritative ordered append-only
   history. Episodes are curated compressible interpretations with their own
   retention. Losing MNEMOSYNE loses recall, not history. `MEMORY_CANDIDATE`
   retention class already models the promotion step.
4. **Vector store != source of truth.** pgvector columns are similarity indexes
   (ADR-0011). Recall ranking uses similarity as one bounded factor of seven;
   contradiction resolution never consults embeddings.
5. **No duplicate authority.** Every new category has exactly one owner, one
   writer (Knowledge Ingestion), one schema — recorded in `DATA_OWNERSHIP.md` §1.

## Reversal difficulty
**Moderate.** The two schemas, the seven contract files, and the mediator port
are additive. Backing the change out means deleting the `atlas`/`mnemosyne`
schemas and the `packages/world-model` + `packages/memory` implementations;
nothing in the frozen 16 changed, so the spine is untouched.
```

- [ ] **Step 2: Add the README row** — in `docs/architecture/adr/README.md`, append to the ADR list:

```markdown
- [0020](0020-knowledge-subsystem-boundary.md) — Knowledge subsystem boundary (ATLAS / MNEMOSYNE)
```

(Match the existing line format in that file; if it is a table, add a table row instead.)

- [ ] **Step 3: Verify no broken links**

Run: `pnpm lint` (docs are not linted, but this confirms nothing else broke). Then manually confirm `0019-operating-modes.md` section headings and `0020` section headings match.
Expected: `lint: clean`

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/adr/0020-knowledge-subsystem-boundary.md docs/architecture/adr/README.md
git commit -m "docs(adr): 0020 knowledge subsystem boundary (MK.46)"
```

---

## Task 15: ADR-0021 — Causal hypothesis model

**Files:**
- Create: `docs/architecture/adr/0021-causal-hypothesis-model.md`
- Modify: `docs/architecture/adr/README.md`

- [ ] **Step 1: Write the ADR** (same section order as 0019)

```markdown
# ADR-0021: Causal hypothesis model — foundations only

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context
JARVIS needs a place to record "deployment A may have caused latency increase B,
confidence 0.78, evidence X/Y/Z" without ever presenting correlation as proven
causation. MK.46 is not the phase to build causal inference; it is the phase to
fix the representation and the write discipline so later phases have somewhere
sound to write.

## Decision
- A single table `atlas.causal_hypotheses` with a four-rung `relationKind`
  ladder: `chronological` < `correlated` < `hypothesised_cause` <
  `established_cause`.
- **Write discipline:** cognition proposals may reach at most
  `hypothesised_cause`. `established_cause` is writable only by (a) an explicit
  principal assertion, or (b) a deterministic derivation with named rule
  support. Knowledge Ingestion enforces this ceiling.
- Every hypothesis carries `confidence`, `evidence[]` (non-empty), `method`,
  and temporal validity.
- The `AtlasQuery.causal()` API returns `relationKind` verbatim; no consumer may
  collapse the ladder.
- **No causal-inference engine this phase.** Only the typed store and the
  ingestion ceiling.

## Alternatives considered
- **A generic `entity_relationships` row of type `caused`.** Rejected: loses the
  distinction between chronology, correlation, hypothesis, and established cause;
  invites exactly the "correlation presented as causation" error.
- **A separate causal graph database.** Rejected per ADR-0011 reasoning — no
  benchmarked need at MK.42 scale; recursive SQL suffices for the read patterns
  MK.46 has (there are none yet beyond "hypotheses touching ref X").
- **Deferring the table entirely to a later MK.** Rejected: later phases will
  produce causal guesses regardless; without a sound store they would land as
  untyped facts or free text, which is worse.

## Benefits
- Correlation can never be silently promoted to cause — the ladder is a schema
  CHECK constraint plus an ingestion ceiling.
- Later causal-inference work has a fixed, evidence-bearing target.
- Zero cost to the rest of the system this phase (one inert table).

## Disadvantages
- A table with no writer until a later phase wires the promotion evaluator and
  cognition proposals. Accepted — foundations by definition.

## Risks
- **A future implementer writes `established_cause` from model output.**
  Mitigated: the ingestion ceiling is enforced in Knowledge Ingestion with a
  test; this ADR is cited in that code.
- **The ladder is too coarse.** Mitigated: `relationKind` is an open-ish enum
  guarded by a CHECK; adding a rung is a migration + this ADR, not a redesign.

## Consequences
- `packages/contracts/src/causal.ts` — `CausalHypothesis`, `RelationKind`.
- `atlas.causal_hypotheses` in migration `0005`.
- `EventNames.WorldCausalHypothesised` = `jarvis.world.causal.hypothesised`.
- `ATLAS_MODEL.md` §Causal hypotheses documents the ladder and discipline.

## Reversal difficulty
**Low.** One table, one contract file, one event name. Nothing depends on it yet.
```

- [ ] **Step 2: README row**

```markdown
- [0021](0021-causal-hypothesis-model.md) — Causal hypothesis model (foundations)
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/adr/0021-causal-hypothesis-model.md docs/architecture/adr/README.md
git commit -m "docs(adr): 0021 causal hypothesis model (MK.46)"
```

---

## Task 16: ADR-0022 — Memory consolidation ("DREAMING")

**Files:**
- Create: `docs/architecture/adr/0022-memory-consolidation.md`
- Modify: `docs/architecture/adr/README.md`

- [ ] **Step 1: Write the ADR** (same section order as 0019)

```markdown
# ADR-0022: Memory consolidation ("DREAMING")

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context
MNEMOSYNE must compress repetition, merge duplicates, promote durable knowledge,
strengthen supported knowledge, decay stale assumptions, surface contradictions,
update procedures, and propose cross-domain links — offline, on a schedule. The
internal nickname is "DREAMING". It is knowledge consolidation, not
consciousness, and it must not become a back door for an LLM to write beliefs.

## Decision
- Consolidation is a **Scheduler routine** (`memory.consolidate`, off-peak
  cadence), not a Kernel component and not an autonomous agent loop.
- It **reads** events, episodes, candidates, objective progress, procedures, and
  working memory; it **produces proposals only**, routed back through Knowledge
  Ingestion. It never writes `atlas.*` or `mnemosyne.*` directly.
- **Every generated insight retains evidence/provenance.** A consolidation
  output with no evidence chain is rejected at ingestion (and by the
  `insights_evidence_nonempty_ck` constraint).
- Until the Agent Runtime exists (MK.45), the routine runs **deterministic rules
  only**. After MK.45 it may invoke the `mnemosyne` agent for summarisation and
  linking — the agent still only proposes.
- `mnemosyne.consolidation_runs` records every pass (inputs scanned, proposals
  emitted, outcomes) for audit.

## Alternatives considered
- **A continuously-running background service.** Rejected: consolidation is
  batch work with no latency requirement; a routine on the existing Scheduler
  costs nothing extra and inherits pause-when-degraded.
- **Let the `mnemosyne` agent write memory directly during consolidation.**
  Rejected: violates L10 (agents own no authoritative state) and the single-
  writer rule (ADR-0020).
- **Generate insights speculatively to seem intelligent.** Explicitly rejected:
  the surfacing gate requires real, evidence-backed, threshold-significant,
  context-relevant, not-already-surfaced insights. Zero insights is normal.

## Benefits
- Reuses the Scheduler's degradation handling and tick observability.
- The proposals-only rule keeps the single-writer boundary intact.
- Deterministic-first means MK.46 ships a working (if modest) consolidator with
  no model dependency.

## Disadvantages
- Deterministic rules produce shallow insight until MK.45. Accepted — the
  pipeline, provenance discipline, and surfacing gate are what MK.46 proves.

## Risks
- **Consolidation storms** (a pass proposing thousands of writes). Mitigated: a
  per-run proposal cap in config; `consolidation_runs` records the count;
  overflow defers to the next run.
- **Decay removes something still true.** Mitigated: decay only lowers
  confidence on `inferred`/`predicted` facts that are stale AND uncorroborated;
  below-floor facts move to `expired` status (archived, recoverable), never hard
  deleted.

## Consequences
- A `memory.consolidate` routine registered with the Scheduler (later plan).
- `EventNames.MemoryConsolidationCompleted` = `jarvis.memory.consolidation.completed`.
- `mnemosyne.consolidation_runs` and `mnemosyne.insights` in migration `0006`.
- `MNEMOSYNE_MODEL.md` §Consolidation and §Morning Insight.

## Reversal difficulty
**Low.** Delete the routine registration and the two tables; MNEMOSYNE still
functions as an append + recall store without consolidation.
```

- [ ] **Step 2: README row**

```markdown
- [0022](0022-memory-consolidation.md) — Memory consolidation ("DREAMING")
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/adr/0022-memory-consolidation.md docs/architecture/adr/README.md
git commit -m "docs(adr): 0022 memory consolidation (MK.46)"
```

---

## Task 17: ADR-0023 — Memory retrieval ranking

**Files:**
- Create: `docs/architecture/adr/0023-memory-retrieval-ranking.md`
- Modify: `docs/architecture/adr/README.md`

- [ ] **Step 1: Write the ADR** (same section order as 0019)

```markdown
# ADR-0023: Memory retrieval ranking — seven factors, similarity bounded

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context
Naive vector recall ranks purely by cosine similarity, which lets the embedding
model dictate what JARVIS "remembers as relevant" — and, worse, invites treating
the nearest vector as the true answer. MNEMOSYNE recall must combine more than
embeddings and must never let similarity alone decide.

## Decision
- Recall is **always** `top-k` with a **relevance floor** — never "all relevant".
- Relevance is a weighted composite of **seven** factors, computed in one SQL
  query over pgvector + scalar columns:
  semantic similarity, entity overlap, recency decay, importance (salience),
  objective relevance, confidence, source authority.
- **`w_sim` (the similarity weight) is bounded** in config so similarity alone
  cannot dominate the composite.
- Weights live in config and are **logged with every recall** (returned as
  `weightsUsed`) for tuning.
- Contradiction resolution in ATLAS **never** consults embeddings — that is
  belief revision by authority ranking and recency (ATLAS_MODEL.md), a separate
  mechanism.
- This ADR **complements** ADR-0011 (pgvector stays; it is one factor here), it
  does not supersede it.

## Alternatives considered
- **Pure cosine similarity + `top-k`.** Rejected: embedding model becomes the
  arbiter of relevance and truth.
- **A learned re-ranker model.** Rejected for MK.46: no training data, adds a
  model dependency to a Kernel read path, non-deterministic. Revisit later.
- **Hard pre-filters only (entity, recency) then cosine.** Rejected: too brittle
  — a relevant episode with no entity tag falls off a cliff. Weighted blend
  degrades gracefully.

## Benefits
- Similarity is a contributor, not a dictator.
- Deterministic and explainable — the `weightsUsed` payload plus the per-factor
  breakdown answers "why did you recall that".
- Tunable without code change.

## Disadvantages
- Seven weights to tune with no ground truth yet. Mitigated: conservative
  defaults (favour precision), logged, adjustable.

## Risks
- **Weight misconfiguration silently degrades recall.** Mitigated: `weightsUsed`
  in every response; a diagnostics view can surface the current weights.
- **pgvector recall quality at growth.** Mitigated per ADR-0011: recall is
  behind the `MemoryRecall` interface; swapping the similarity engine is an
  adapter + sync path, not a schema redesign.

## Consequences
- `packages/contracts/src/memory-recall.ts` — `MemoryRecall`, `RecallQuery`,
  `RecallWeights`, `RecalledItem`.
- Recall weights added to Kernel config (later plan).
- `MNEMOSYNE_MODEL.md` §Retrieval documents the formula.

## Reversal difficulty
**Low.** The formula lives in one query builder behind `MemoryRecall`. Changing
the factor set or weights is a localised change; callers are unaffected.
```

- [ ] **Step 2: README row**

```markdown
- [0023](0023-memory-retrieval-ranking.md) — Memory retrieval ranking (seven factors)
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/adr/0023-memory-retrieval-ranking.md docs/architecture/adr/README.md
git commit -m "docs(adr): 0023 memory retrieval ranking (MK.46)"
```

---

## Task 18: New model docs — `ATLAS_MODEL.md` and `MNEMOSYNE_MODEL.md`

**Files:**
- Create: `docs/architecture/ATLAS_MODEL.md`
- Create: `docs/architecture/MNEMOSYNE_MODEL.md`
- Modify: `docs/architecture/WORLD_MODEL.md` (convert to a pointer + keep the historical sketch)
- Modify: `docs/architecture/STATE_MODEL.md` (§Memory row / §6 Memory bullet → pointer to `MNEMOSYNE_MODEL.md`)
- Modify: `docs/architecture/README.md` (add the two new docs to the index)

- [ ] **Step 1: Write `ATLAS_MODEL.md`** — lift spec sections 2, 4, 6, 7, 8 verbatim-ish, structured as: `## 1 What it holds` / `## 2 Schema (atlas.*)` / `## 3 Provenance, confidence, epistemic status` / `## 4 Ingestion` (point to Knowledge Ingestion + ADR-0020) / `## 5 Belief revision` / `## 6 Observation layer & promotion` / `## 7 Causal hypotheses` (point to ADR-0021) / `## 8 Temporal query API` (the `AtlasQuery` method table) / `## 9 What ATLAS must never do` / `## 10 Consistency`. Header:

```markdown
# ATLAS — The Temporal World Model

The current, structured, provenance-bearing model of the world. Answers "what is
true now, and why" (L8, L11–L17). Phase: MK.46. Subordinate to
[`PRINCIPLES.md`](PRINCIPLES.md); governed by
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md),
[ADR-0021](adr/0021-causal-hypothesis-model.md).

Distinct from MNEMOSYNE ([`MNEMOSYNE_MODEL.md`](MNEMOSYNE_MODEL.md)) and from the
Kernel State Manager ([`STATE_MODEL.md`](STATE_MODEL.md)). Written only by the
Kernel Knowledge Ingestion mediator.
```

Include the `AtlasQuery` method table from spec §6.1 and the §8 "boundary proof"
points 1 and 4 as a `## What ATLAS is not` section.

- [ ] **Step 2: Write `MNEMOSYNE_MODEL.md`** — lift spec sections 3, 5, 6.2, 7 structured as: `## 1 What it holds` / `## 2 Memory classes` (the durable-vs-pointer table from spec §5.1) / `## 3 Schema (mnemosyne.*)` / `## 4 Memory Candidate pipeline` / `## 5 Consolidation ("DREAMING")` (point to ADR-0022) / `## 6 Morning Insight` / `## 7 Retrieval` (the seven-factor formula, point to ADR-0023) / `## 8 Forgetting` / `## 9 Privacy` / `## 10 What MNEMOSYNE must never do` / `## 11 Auditability`. Header:

```markdown
# MNEMOSYNE — Memory

What JARVIS has retained from experience and learned knowledge. Answers "what
past experience is relevant to now". Append-mostly, lossy-compressible, NOT
authoritative truth (L8). Phase: MK.46. Subordinate to
[`PRINCIPLES.md`](PRINCIPLES.md); governed by
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md),
[ADR-0022](adr/0022-memory-consolidation.md),
[ADR-0023](adr/0023-memory-retrieval-ranking.md).

Distinct from ATLAS ([`ATLAS_MODEL.md`](ATLAS_MODEL.md)) and the Event Log.
Written only by the Kernel Knowledge Ingestion mediator.
```

Include spec §8 boundary-proof points 2 and 3 as a `## What MNEMOSYNE is not`
section.

- [ ] **Step 3: Convert `WORLD_MODEL.md` to a pointer** — replace its body below the H1 with:

```markdown
> **Superseded by [`ATLAS_MODEL.md`](ATLAS_MODEL.md) (MK.46).** ATLAS is the
> implemented name for the World Model subsystem. This document is retained for
> historical context (the GENESIS sketch) and for the `world_model` → `atlas`
> schema rename recorded in [ADR-0020](adr/0020-knowledge-subsystem-boundary.md).

<details><summary>Historical GENESIS sketch</summary>

[...original content unchanged, indented inside the details block...]

</details>
```

- [ ] **Step 4: Update `STATE_MODEL.md`** — in the §1 five-stores table, change the **Memory** row's "Question" cell to reference `MNEMOSYNE_MODEL.md`, and in §6 change the "Memory:" bullet to: `**Memory** (MNEMOSYNE): retention, summarisation, and decay are defined in [`MNEMOSYNE_MODEL.md`](MNEMOSYNE_MODEL.md) §Forgetting. Never touches ledger events.` Leave the rest of `STATE_MODEL.md` unchanged.

- [ ] **Step 5: Update `docs/architecture/README.md`** — add `ATLAS_MODEL.md` and `MNEMOSYNE_MODEL.md` to the document index in the same format as the existing entries.

- [ ] **Step 6: Verify**

Run: `pnpm lint`
Expected: `lint: clean` (docs not linted; this just confirms nothing else broke). Manually grep for dangling links:

Run: `grep -rn "ATLAS_MODEL\|MNEMOSYNE_MODEL" docs/ | grep -v "\.md:"` — should be empty (all references are inside `.md` files).

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/ATLAS_MODEL.md docs/architecture/MNEMOSYNE_MODEL.md docs/architecture/WORLD_MODEL.md docs/architecture/STATE_MODEL.md docs/architecture/README.md
git commit -m "docs(arch): ATLAS_MODEL + MNEMOSYNE_MODEL; WORLD_MODEL becomes a pointer (MK.46)"
```

---

## Task 19: Update `DATA_OWNERSHIP.md`, `GLOSSARY.md`, `KERNEL_CONSTITUTION.md`, `ROADMAP.md`

**Files:**
- Modify: `docs/architecture/DATA_OWNERSHIP.md`
- Modify: `docs/architecture/GLOSSARY.md`
- Modify: `docs/architecture/KERNEL_CONSTITUTION.md`
- Modify: `docs/architecture/ROADMAP.md`
- Modify: `infrastructure/postgres/README.md`

- [ ] **Step 1: `DATA_OWNERSHIP.md` §1** — replace the existing `Memories`, `Entities`, `Entity relationships`, `Facts`, `Observations`, `Evidence graph` rows (they name the old owners "Memory service" / "World Model service") with these, and add the new categories. Keep the table's column format (`Category | Owner | Store | Consistency | Cache allowed`):

```markdown
| **Entities** (ATLAS) | Knowledge Ingestion (writer); ATLAS service (owner/reader) | PG `atlas.entities` (+ `entity_aliases`) | Strong for identity/type; eventual for attributes | — |
| **Entity relationships** (ATLAS) | Knowledge Ingestion (writer); ATLAS service | PG `atlas.entity_relationships` | Strong | — |
| **Facts** (ATLAS) | Knowledge Ingestion (writer); ATLAS service | PG `atlas.facts` (+ `facts_archive`) | Eventual; conflicts recorded not resolved-by-write | — |
| **Evidence graph** (ATLAS) | Knowledge Ingestion (writer); ATLAS service | PG `atlas.evidence` | Eventual | — |
| **Conflicts** (ATLAS) | Knowledge Ingestion (writer); ATLAS service | PG `atlas.conflicts` | Eventual | — |
| **Observation index** (ATLAS) | Knowledge Ingestion (writer); ATLAS service | PG `atlas.observations` | Eventual | — |
| **Causal hypotheses** (ATLAS) | Knowledge Ingestion (writer); ATLAS service | PG `atlas.causal_hypotheses` | Eventual | — |
| **Episodes** (MNEMOSYNE) | Knowledge Ingestion (writer); MNEMOSYNE service | PG `mnemosyne.episodes` + pgvector + object storage refs | Eventual | pgvector index is derived |
| **Semantic memory** (MNEMOSYNE) | Knowledge Ingestion (writer); MNEMOSYNE service | PG `mnemosyne.semantic` + pgvector | Eventual | — |
| **Procedures** (MNEMOSYNE) | Knowledge Ingestion (writer); MNEMOSYNE service | PG `mnemosyne.procedures` | Eventual | — |
| **Preferences** (MNEMOSYNE) | Knowledge Ingestion (writer); MNEMOSYNE service | PG `mnemosyne.preferences` | Eventual | — |
| **Memory candidates** (MNEMOSYNE) | Knowledge Ingestion (writer); MNEMOSYNE service | PG `mnemosyne.candidates` | Eventual | — |
| **Consolidation runs** (MNEMOSYNE) | MNEMOSYNE consolidation routine | PG `mnemosyne.consolidation_runs` | Eventual | — |
| **Insights** (MNEMOSYNE) | Knowledge Ingestion (writer); MNEMOSYNE service | PG `mnemosyne.insights` | Eventual | — |
```

Then add a paragraph under the table:

```markdown
**Knowledge Ingestion** is the single writer to `atlas.*` and `mnemosyne.*` — a
Kernel-internal protected service (Executor-class), not a frozen-16 component
(ADR-0020). Perception, cognition, agents, and interfaces reach it only via
observations, validated proposals, or principal-assertion commands.
`working` / `session` / `spatial` memory are NOT MNEMOSYNE-owned: they remain
with the Ephemeral store, Session Manager, and Scene service respectively.
```

- [ ] **Step 2: `GLOSSARY.md`** — under `## Memory vs World Model`, add:

```markdown
**ATLAS** — the implemented name for the temporal World Model subsystem (MK.46).
Schema `atlas`. Not to be confused with the `atlas` agent (data analysis) —
capitalised ATLAS is the subsystem, lower-case `atlas` is a disposable worker.

**MNEMOSYNE** — the implemented name for the Memory subsystem (MK.46). Schema
`mnemosyne`. Not to be confused with the `mnemosyne` agent (memory curation) —
capitalised MNEMOSYNE is the subsystem, lower-case `mnemosyne` is a disposable
worker.

**Knowledge Ingestion** — the Kernel-internal protected service that is the sole
writer to `atlas.*` and `mnemosyne.*` (ADR-0020). Executor-class: protected, not
one of the frozen 16.

**RelationKind** — the four-rung ladder for `atlas.causal_hypotheses`:
`chronological` < `correlated` < `hypothesised_cause` < `established_cause`.
Cognition may propose at most `hypothesised_cause` (ADR-0021).

**MemoryClass** — one of `episodic`, `semantic`, `procedural`, `preference` (the
four durable, schema-backed MNEMOSYNE classes). `working` / `session` / `spatial`
memory are pointers to other Kernel owners; `entity memory` is a query.

**Memory Candidate** — a scored, not-yet-accepted item in
`mnemosyne.candidates`. Disposition: `accepted | merged | rejected | expired |
deferred`. Nothing becomes an Episode without passing this gate.

**DREAMING** — the internal nickname for MNEMOSYNE's scheduled offline
consolidation routine (ADR-0022). Knowledge consolidation, not consciousness.
Emits proposals only.

**Morning Insight** — MNEMOSYNE surfacing "I noticed something overnight" via the
Notification Manager, only for real, evidence-backed, threshold-significant,
context-relevant, not-already-surfaced insights.
```

- [ ] **Step 3: `KERNEL_CONSTITUTION.md`** — at the end of §1 (right after the paragraph about the Capability Executor being "not a 16th top-level component but is equally protected"), add:

```markdown
**Knowledge Ingestion** is likewise a Kernel-internal protected service of the
knowledge subsystem — the sole writer to `atlas.*` (ATLAS) and `mnemosyne.*`
(MNEMOSYNE). It is not a 17th top-level component. It is documented in
`ATLAS_MODEL.md`, `MNEMOSYNE_MODEL.md`, and `adr/0020-knowledge-subsystem-boundary.md`.
```

- [ ] **Step 4: `ROADMAP.md`** — in the `### MK.46 — Knowledge` block, append:

```markdown

**Status (2026-09-01):** Foundation landed — contracts (`causal`, `memory`,
`memory-candidate`, `memory-insight`, `knowledge-ingestion`, `atlas-query`,
`memory-recall`; `entity`/`fact`/`observation` extended), schemas `atlas` +
`mnemosyne` (migrations 0005/0006), ADR-0020..0023, `ATLAS_MODEL.md` +
`MNEMOSYNE_MODEL.md`. Services (ingestion mediator, ATLAS read/write, MNEMOSYNE
recall/consolidation/insight) are the next sub-plans.
```

- [ ] **Step 5: `infrastructure/postgres/README.md`** — in the init-scripts list, change the `10-schemas.sql` line's schema list from `world_model`, `memory` to `atlas`, `mnemosyne`, and change the `40-vector-indexes.sql` line to `HNSW indexes on mnemosyne.* and atlas.entities embedding columns`. Add a note: `Schema names atlas / mnemosyne per ADR-0020 (renamed from the world_model / memory sketch).`

- [ ] **Step 6: Verify & commit**

Run: `pnpm lint`
Expected: `lint: clean`

```bash
git add docs/architecture/DATA_OWNERSHIP.md docs/architecture/GLOSSARY.md docs/architecture/KERNEL_CONSTITUTION.md docs/architecture/ROADMAP.md infrastructure/postgres/README.md
git commit -m "docs(arch): DATA_OWNERSHIP/GLOSSARY/KERNEL_CONSTITUTION/ROADMAP for MK.46 knowledge"
```

---

## Task 20: New diagrams — `atlas-ingestion.mmd`, `mnemosyne-consolidation.mmd`

**Files:**
- Create: `docs/architecture/diagrams/atlas-ingestion.mmd`
- Create: `docs/architecture/diagrams/mnemosyne-consolidation.mmd`
- Modify: `docs/architecture/diagrams/README.md`

- [ ] **Step 1: Write `atlas-ingestion.mmd`** — match the comment-header + `flowchart` style of `world-model-interactions.mmd`:

```
%% How knowledge gets in: one mediator, routed to ATLAS and/or MNEMOSYNE as
%% SEPARATE records. Writers: Knowledge Ingestion only. See ../ATLAS_MODEL.md,
%% ../MNEMOSYNE_MODEL.md, ../adr/0020-knowledge-subsystem-boundary.md.
flowchart TB
    subgraph inputs["Inputs (never write atlas.* / mnemosyne.* directly)"]
        OBS[Perception observation events]
        PROP[Validated cognition proposal]
        ASSERT[Principal assertion -> Command]
        CONS[DREAMING consolidation proposal]
    end

    OBS --> KI[Knowledge Ingestion (Kernel-internal, sole writer)]
    PROP --> KI
    ASSERT --> KI
    CONS --> KI

    KI --> STAMP[stamp provenance + privacyClass + untrusted tag]
    STAMP --> ER[entity resolution (once)]
    ER --> ROUTE{route by IngestionKind}

    ROUTE -->|observation| AOBS[(atlas.observations)]
    ROUTE -->|extracted fact| AFACT[dedupe / supersede / conflict]
    ROUTE -->|episode| MEPI[(mnemosyne.episodes)]
    ROUTE -->|fact + experience| BOTH[atlas fact + mnemosyne episode\ncross-linked by evidence.ref]

    AFACT -->|new / refines| AF[(atlas.facts + evidence)]
    AFACT -->|contradicts| AC[(atlas.conflicts — no overwrite)]
    BOTH --> AF
    BOTH --> MEPI

    AF --> E1[[emit jarvis.world.fact.asserted / superseded]]
    AC --> E2[[emit jarvis.world.conflict.recorded]]
    MEPI --> E3[[emit jarvis.memory.episode.recorded]]
    AOBS --> E4[[promotion evaluator (scheduled) -> proposal, not a direct write]]
```

- [ ] **Step 2: Write `mnemosyne-consolidation.mmd`**:

```
%% DREAMING: a scheduled routine that READS broadly and emits PROPOSALS ONLY,
%% back through Knowledge Ingestion. It never writes atlas.* / mnemosyne.*
%% directly. See ../MNEMOSYNE_MODEL.md, ../adr/0022-memory-consolidation.md.
flowchart TB
    SCHED[Scheduler: memory.consolidate routine (off-peak)] --> RUN[Consolidation pass]

    subgraph reads["Reads (no writes)"]
        EVT[events]
        EPI[mnemosyne.episodes]
        CAND[mnemosyne.candidates]
        OBJ[objective progress]
        PROC[mnemosyne.procedures]
        WM[working memory (Redis)]
    end
    reads --> RUN

    RUN --> OPS{deterministic rules (MK.46)\n+ mnemosyne agent (post-MK.45)}
    OPS --> P1[compress repetition / merge duplicates]
    OPS --> P2[promote durable knowledge -> semantic]
    OPS --> P3[strengthen supported / decay stale]
    OPS --> P4[surface contradictions -> ATLAS conflict]
    OPS --> P5[update procedures]
    OPS --> P6[candidate insights (evidence mandatory)]

    P1 & P2 & P3 & P4 & P5 & P6 --> KI[Knowledge Ingestion (proposals only)]
    RUN --> LOG[(mnemosyne.consolidation_runs)]
    P6 --> INS[(mnemosyne.insights)]
    INS --> GATE{surfacing gate:\nsignificance >= threshold AND relevant\nAND not surfaced AND evidence-backed}
    GATE -->|pass| NOTIFY[[emit jarvis.memory.insight.available -> Notification Manager]]
    GATE -->|fail / none| HOLD[no notification — the normal case]
```

- [ ] **Step 3: Update `docs/architecture/diagrams/README.md`** — add both files to the index with a one-line description each, matching the existing entries' format.

- [ ] **Step 4: Verify the mermaid parses** — if `mmdc` (mermaid CLI) is not installed (it is not a repo dep), visually check that every `subgraph` has a matching `end` and node ids are unique. Confirm both files start with `%%` comment lines and a `flowchart` directive like the sibling `.mmd` files.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/diagrams/atlas-ingestion.mmd docs/architecture/diagrams/mnemosyne-consolidation.mmd docs/architecture/diagrams/README.md
git commit -m "docs(diagrams): atlas-ingestion + mnemosyne-consolidation (MK.46)"
```

---

## Task 21: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: `tsc` exits 0, no output.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: `lint: clean`

- [ ] **Step 3: Unit tests**

Run: `pnpm test`
Expected: all existing tests + the new `event-names.test.ts` (3 tests) pass. Integration tests self-skip unless Docker/`JARVIS_TEST_DB_URL` present.

- [ ] **Step 4: Integration test (if Docker available)**

Run: `pnpm test:integration`
Expected: `knowledge-schema.integration.test.ts` passes all assertions (11); existing integration tests still pass.

- [ ] **Step 5: Contract export sanity**

Run:
```bash
node --experimental-strip-types -e "import('@jarvis/contracts').then(m => { const need = ['RelationKind','Episode','MemoryCandidate','Insight','KnowledgeIngestion','AtlasQuery','MemoryRecall','EventNames']; const missing = need.filter(n => !(n in m)); if (missing.length) throw new Error('missing exports: ' + missing.join(',')); console.error('exports ok'); })"
```
Expected: `exports ok`. (Type-only exports like `RelationKind` won't appear at runtime — adjust to check `EventNames.WorldFactAsserted` and `EventNames.MemoryEpisodeRecorded` are defined; the type names are verified by `pnpm typecheck` already.)

Simplified reliable check:
```bash
node --experimental-strip-types -e "import('@jarvis/contracts').then(m => { if (m.EventNames.WorldFactAsserted !== 'jarvis.world.fact.asserted') throw new Error('bad'); if (m.EventNames.MemoryEpisodeRecorded !== 'jarvis.memory.episode.recorded') throw new Error('bad'); console.error('exports ok'); })"
```
Expected: `exports ok`

- [ ] **Step 6: Spec coverage check** — confirm each spec deliverable in §9 maps to a task:
  - §9.1 contracts → Tasks 1–10 ✓
  - §9.2 schemas → Tasks 11–12 ✓
  - §9.3 packages/modules → *deferred to service plans* (this plan is foundation only; note in the commit)
  - §9.4 ADRs → Tasks 14–17 ✓
  - §9.5 doc updates → Tasks 18–20 ✓
  - §10 testing → Task 13 covers the schema/boundary tests; the behavioural suites are in the service plans

- [ ] **Step 7: Commit the verification note**

```bash
git add -A
git commit -m "chore: MK.46 knowledge foundation complete — contracts, schemas, ADRs, docs verified"
```

---

## Self-Review

**1. Spec coverage.** Every spec §9 deliverable that is *declaration* (contracts, schemas, ADRs, docs, diagrams) has a task. Spec §9.3 (service implementations) and the behavioural half of §10 are explicitly out of this plan's scope — they are the follow-up service plans, which need the MK.44/45 stub shapes first. Spec §3–§8 (mediator logic, ATLAS/MNEMOSYNE service behaviour, retrieval ranking code, consolidation, insight, forgetting jobs) are represented here only as contracts + ADR text; their implementations are follow-up plans.

**2. Placeholder scan.** No "TBD/TODO/implement later". Doc tasks (14–20) contain the full ADR/markdown text or an exact section-by-section instruction with the header block written out. Migration and contract tasks contain complete file bodies. The one "lift spec sections verbatim-ish" instruction (Task 18 Steps 1–2) is bounded by an explicit section list and header block — acceptable for a doc task where the source text is the approved spec in the same repo.

**3. Type consistency.** `PrivacyClass` defined in `entity.ts` (Task 1), imported by `fact.ts` (Task 2), `memory.ts` (Task 5), `knowledge-ingestion.ts` (Task 8). `EpistemicStatus` reused from `provenance.ts` everywhere, never redefined. `RelationKind` values identical in `causal.ts` (Task 4), `0005_atlas.sql` CHECK (Task 11), ADR-0021 (Task 15), glossary (Task 19). `CandidateDisposition` values identical in `memory-candidate.ts` (Task 6) and `0006_mnemosyne.sql` CHECK (Task 12). Table name lists in the Task 13 test exactly match the `create table` statements in Tasks 11–12 (atlas: causal_hypotheses, conflicts, entities, entity_aliases, entity_relationships, evidence, facts, facts_archive, observations; mnemosyne: candidates, consolidation_runs, episodes, insights, preferences, procedures, semantic). `EventNames` keys in Task 10 match the strings asserted in `event-names.test.ts` (same task) and referenced in Tasks 15/16/20.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-01-atlas-mnemosyne-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
