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

---

## 1 What it holds

> **Implemented (MK.46, ADR-0039).** Runtime lives in the Kernel modular
> monolith, not in `packages/memory` (a README pointer): schema `mnemosyne`,
> code under `apps/core/src/kernel/mnemosyne/` (`MnemosyneStore`,
> `MemoryRecallService` — the seven-factor composite, `scoreCandidate` /
> `decideDisposition`, `Consolidator` — deterministic DREAMING). The sole writer
> and the `ConsolidationSink` are `apps/core/src/kernel/knowledge/knowledge-ingestion.ts`;
> events become candidates via `.../knowledge/candidate-source.ts`.

MNEMOSYNE is the memory subsystem — schema `mnemosyne`. It holds curated,
compressible, decaying interpretations built from events: episodes (narrative),
learned semantic knowledge, repeatable procedures, and non-sensitive interaction
preferences. It is a cognitive resource, not a source of truth. Losing MNEMOSYNE
loses recall quality, not history.

`MNEMOSYNE` (capitalised) is the subsystem. `agents/mnemosyne` (memory curation)
is an unchanged disposable worker; the Glossary disambiguates subsystem vs agent.

MNEMOSYNE is written **only** by the Kernel **Knowledge Ingestion** mediator — a
Kernel-internal protected service with Executor-class status (named and protected
in the Kernel Constitution, but **not** a 17th entry in the frozen 16). Every
other producer — perception, cognition, agents, interfaces, the DREAMING routine
— reaches MNEMOSYNE only by emitting observations or validated proposals. See
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md).

## 2 Memory classes

Five durable classes are schema-backed; three transient / borrowed classes are
**pointers, not stores**. This split is the boundary argument against L5 /
ADR-0017: working and session memory are not re-owned by MNEMOSYNE.

| Class | Realisation | Owner of truth |
|---|---|---|
| **Episodic** | `mnemosyne.episodes` — time bounds, participants (entity ids), summary, body ref, source-event ids, `salience`, embedding | MNEMOSYNE |
| **Semantic** | `mnemosyne.semantic` — durable learned concept / knowledge statements, embedding, source episodes | MNEMOSYNE |
| **Procedural** | `mnemosyne.procedures` — named repeatable processes: ordered `{ step, action, checkRef }[]`, `version`, `lastValidatedAt` | MNEMOSYNE |
| **Preference** | `mnemosyne.preferences` — **non-sensitive interaction preferences only**; `privacyClass` capped at `INTERNAL`; sensitive personal facts go to ATLAS, not here | MNEMOSYNE |
| **Entity memory** | a **view / query**, not a table: episodes + semantic rows linked to an ATLAS entity id | MNEMOSYNE (index) / ATLAS (entity identity) |
| Working | Kernel Ephemeral (Redis). MNEMOSYNE **reads** it during consolidation; never persists it | Ephemeral store |
| Session | projection over `session.*` + episode links; no new store | Session Manager |
| Spatial | reference to Scene service placements; MNEMOSYNE stores only an episode's `sceneRef` | Scene service |

## 3 Schema (`mnemosyne.*`)

Tables: `episodes`, `semantic`, `procedures`, `preferences`, `candidates`,
`consolidation_runs`, `insights`. pgvector + HNSW indexes for recall; `episodes`
is a plain table (archival is move-based, not declarative partitioning);
`principalId` on every table (L34); the schema has its own per-schema DB role.

- `episodes` — narrative units. Time bounds, `participants` (ATLAS entity ids),
  `summary`, body ref (raw body to object storage past a threshold), source-event
  ids, `salience`, `confidence`, `provenance`, `privacyClass`, `embedding`,
  `supersededBy`, `sceneRef?`.
- `semantic` — durable learned statements; `embedding`, source-episode ids,
  `confidence`, `provenance`, `privacyClass`.
- `procedures` — ordered `{ step, action, checkRef }[]`, `version`,
  `lastValidatedAt`.
- `preferences` — key / value interaction preferences, `privacyClass` ≤
  `INTERNAL`.
- `candidates` — see §4.
- `consolidation_runs` — one row per DREAMING pass (inputs scanned, proposals
  emitted, outcomes).
- `insights` — see §6.

Cross-link to ATLAS is one-directional and by reference only: an ATLAS fact's
`evidence.ref` may be an `episodeId`. Content is never copied either way.

## 4 Memory Candidate pipeline

`mnemosyne.candidates` — events tagged `retentionClass: MEMORY_CANDIDATE`
(`EVENT_ARCHITECTURE.md`) plus session / objective outcomes land here first. A
scorer computes weighted factors and **stores the component breakdown**
(auditable, tunable):

`novelty`, `importance`, `futureUtility`, `objectiveRelevance`, `confidence`,
`duplication` (penalty), `sensitivity` (penalty / defer), `durability`,
`sourceQuality` → `candidateScore`.

Disposition: `accepted | merged | rejected | expired | deferred`, each emitting
`jarvis.memory.candidate.*`. **Nothing becomes an episode without passing this
gate.** Not every conversation line is stored.

## 5 Consolidation ("DREAMING")

A Scheduler routine `memory.consolidate` (off-peak cadence). **Not** cognition
with authority: it reads events, episodes, candidates, objective progress, and
procedures; it produces **proposals only**, routed back through the Knowledge
Ingestion mediator — it never writes `mnemosyne.*` or `atlas.*` directly.

Operations: compress repetition; merge duplicate episodes; promote durable
knowledge to semantic memory; strengthen well-supported knowledge (confidence
up); decay stale assumptions (confidence down); surface contradictions (→ ATLAS
`conflicts`); update procedures from repeated action patterns; archive transient
episodes; propose cross-domain links.

**Every generated insight retains evidence / provenance.** A consolidation output
with no evidence chain is rejected by Knowledge Ingestion.
`mnemosyne.consolidation_runs` records each pass for auditability. The
`mnemosyne` agent may be *invoked by* this routine for summarisation / linking
once the Agent Runtime exists (MK.45); until then the routine runs deterministic
rules only. It is knowledge consolidation, not consciousness. Rationale:
[ADR-0022](adr/0022-memory-consolidation.md).

## 6 Morning Insight

`mnemosyne.insights` — consolidation writes candidate insights with
`significance`, `provenance`, `evidence[]`, `surfaced boolean`, `supersededBy`. A surfacing
check emits `jarvis.memory.insight.available` **only** when: significance ≥
threshold **and** relevant to a current objective / context **and** not already
surfaced **and** evidence-backed. The **Notification Manager** (frozen-16
component #14) delivers it under its normal interruption gate. **The pipeline
producing zero insights is the expected normal case** — no insight is fabricated
to appear intelligent.

## 7 Retrieval

The `MemoryRecall` service interface (`packages/contracts/src/memory-recall.ts`).
Recall is **always** `top-k` + a relevance floor — never "all relevant" (review
§16.12). Relevance is a weighted composite computed in **one SQL query** over
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

The seven factors: **semantic similarity** (bounded), **entity overlap**,
**recency decay**, **importance / salience**, **objective relevance**,
**confidence**, **source authority**. Weights live in config and are logged with
each recall for tuning. `w_sim` is bounded so similarity alone cannot dominate —
cosine similarity does not dictate truth. Class filter and `principalId` scope
are SQL predicates, not post-filters. Rationale:
[ADR-0023](adr/0023-memory-retrieval-ranking.md).

`MemoryRecall` never calls `AtlasQuery`. Only the Context Compiler fuses the two,
filling its priority-tiered budget (`COGNITION_MODEL.md` §4.2): facts before
episodes, both before supporting material. `ContextFrame.freshness` carries
`memoryAsOf`.

## 8 Forgetting

"Store everything forever" is forbidden. Each mechanism has one owner and emits
an event.

| Mechanism | MNEMOSYNE behaviour |
|---|---|
| Expiry | episodes / candidates past class TTL; raw bodies → object storage, metadata + embedding kept hot |
| Supersession | episode merge → `supersededBy`; procedure version bump |
| Confidence decay | low-relevance semantic rows: `relevance × age` → prune candidate |
| Archival | rolling summaries replace raw episodes; bodies to MinIO |
| Manual / privacy deletion | `mnemosyne.forget(episodeId \| subjectRef, reason)` — hard-deletes rows **and** evidence, cascades to derived semantic rows, writes a `jarvis.memory.record.forgotten` tombstone (id + reason + actor, no content) |
| Retention rules | per memory-class + `privacyClass` table (this document) |

Deletion is the one operation that genuinely removes data (right-to-erasure);
everything else archives. **Ledger events are never touched**
([`STATE_MODEL.md`](STATE_MODEL.md) §6); the tombstone records only *that* a
forget happened.

## 9 Privacy

`privacyClass` (`PUBLIC | INTERNAL | SENSITIVE | RESTRICTED`, the event-envelope
enum) on every episode, semantic row, and preference.

- Preference memory is capped at `INTERNAL`; sensitive personal data belongs in
  ATLAS facts, not preferences.
- `RESTRICTED` knowledge never enters a `ContextFrame` bound for a non-local
  model (the Context Compiler filters on it — mechanism already exists).
- Untrusted-derived rows carry `derivedFromUntrusted` and cannot alone justify
  `riskClass > LOW` (review §16.8).
- Every row is `principalId`-scoped from day one (L34); multi-user isolation is a
  row filter, not a re-architecture.

## 10 What MNEMOSYNE must never do

- Become another State Manager, or a dumping ground for arbitrary state. Working
  and session memory stay owned by the Ephemeral store and the Session Manager.
- Hold authoritative truth. Episodes are lossy, decaying interpretations.
- Store sensitive personal facts as preferences — those are ATLAS facts.
- Write `atlas.*`, `projections.*`, or any frozen-16 component's schema.
- Be written by anything other than the Knowledge Ingestion mediator.
- Copy Event Log content and treat it as history — the Event Log is
  authoritative; MNEMOSYNE episodes are curated derivations of it.
- Store an episode that has not passed the Memory Candidate gate.

## 11 Auditability

No new audit store — the Audit Manager (frozen-16 component #16) derives from the
`jarvis.memory.*` / `jarvis.world.*` events, which all carry provenance +
`correlationId`.

| Question | Answered by |
|---|---|
| "Why do you remember that?" | `mnemosyne.candidates.scoreBreakdown` + `consolidation_runs` |
| "When did you learn that?" | `createdAt` + originating `correlationId` |
| "Where did that come from?" | `provenance` (mandatory) + `evidence[]` chain |
| "Is that a fact or an inference?" | `epistemicStatus` / `factType` (mandatory, never defaulted) |
| "How confident are you?" | `confidence` (mandatory) |
| "Did you used to believe something different?" | `history()` + ATLAS `facts_archive` + `conflicts` |

## 12 What MNEMOSYNE is not

Two of the five boundary-proof points from the design spec (all five are in
[ADR-0020](adr/0020-knowledge-subsystem-boundary.md)):

1. **Memory ≠ world model.** MNEMOSYNE stores episodes (narrative, lossy,
   decaying). ATLAS stores facts (structured, provenance-bound, revised not
   deleted). The only coupling is evidence pointers — an ATLAS fact may cite a
   MNEMOSYNE episode id. Content is never copied. Neither writes the other; only
   the Knowledge Ingestion mediator writes, and it writes them as separate
   records.
2. **Memory ≠ event log.** The Event Log is authoritative, ordered, append-only
   history. MNEMOSYNE episodes are curated, compressible, decaying
   interpretations built from events, with their own retention. Losing MNEMOSYNE
   loses recall quality, not history. The `MEMORY_CANDIDATE` retention class
   already models the promotion step.
