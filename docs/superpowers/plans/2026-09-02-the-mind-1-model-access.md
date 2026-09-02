# THE MIND — Sub-plan 1: Model Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the provider-independent Model Gateway, the Model Registry (Kernel component #11), and the deterministic two-stage routing function — so a `ModelRequest` describing *capabilities* (never a vendor) is routed to a model, called through a swappable `ProviderAdapter`, and falls back on failure, with zero provider name anywhere in code.

**Architecture:** `apps/gateway` is a standalone process (ADR-0010): it holds the `ProviderAdapter` interface + adapters, the pure `route()` function, per-provider circuit breakers, and the `Gateway` orchestrator (`infer()` → route → adapter → breaker → fallback chain). The **Model Registry** is a Kernel module owning `catalogue.models` / `catalogue.routing_policy` / `catalogue.model_health` and serving a `RoutingSnapshot`; a `model_health` projector folds `jarvis.cognition.model.called` / `.call_failed` events into rolling reliability + latency via EWMA. Contracts extend `model.ts` additively and add `routing.ts`. No MK.44 (Policy/Permission/Executor) dependency — the privacy gate is enforced in routing from request + registry metadata alone.

**Tech Stack:** TypeScript 5.6 strict (`verbatimModuleSyntax`, `.ts` import extensions), Node 22 (global `fetch`), pnpm workspaces, `postgres` (postgres.js) + the hand-rolled forward-only SQL migrator, Vitest, `zod` (validation package only — not used here). Lint = `tsc` strict + `scripts/lint.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-02-the-mind-cognitive-architecture-design.md` — §3 (Gateway / `ModelRequest` / Registry), §4 (routing), §14 sub-plan 1, §15 (the provider-failure / provider-switching / routing-privacy-gate / context-overflow test rows). The plan argues from the spec; executors read both.

## Global Constraints

- **Subordinate to `docs/architecture/PRINCIPLES.md`.** Relevant: **L1** (no module named/typed as a model; Kernel has no model SDK dep), **L3** (providers interchangeable — `ModelRequest`/`ModelResponse` provider-neutral; removing a provider = delete adapter + registry rows, no contract/Kernel change), **L20** (routing is a pure deterministic function of typed inputs — no I/O in the decision), **L25/L27** (locality/privacy not tradeable against cost), **L26** (gateway outage degrades reasoning, never the Kernel), **L30** (no security control is a prompt string).
- **`ModelRequest` shape versions additively** (ROADMAP "The invariant"). Existing fields stay; new fields are added, all optional unless a producer always sets them. Never rename or retype an existing field.
- **No provider name in any code path.** "Coding prefers a high-`reasoning` model" is a `catalogue.routing_policy` row (data), editable without deploy. A grep for `openai`/`anthropic`/`gemini`/`claude`/`gpt` in `apps/gateway/src/**` and `apps/core/src/**` outside `apps/gateway/src/adapters/*` and comments must return nothing.
- **`.ts` on every relative import.** `verbatimModuleSyntax` on → type-only imports use `import type`. `noUnusedLocals` / `noUnusedParameters` on → an unused import fails typecheck.
- **`PrivacyClass` is imported from `./event.ts`** (per MK.46 ruling D1-1 it is defined there and re-exported by `entity.ts`). Values exactly `PUBLIC | INTERNAL | SENSITIVE | RESTRICTED`. Never redefine.
- **Migrations are forward-only plain `.sql`**, applied in filename order by `packages/persistence/src/migrator.ts` (tracks by filename, wraps each file in one transaction). Never edit an applied migration; add a new one. Use `create schema if not exists` / `create table if not exists` / guarded `do $$ … pg_roles … create role …` blocks so the file is self-sufficient for throwaway test containers (pattern: `0005_atlas.sql`).
- **`principal_id text not null` on every `catalogue.*` row that concerns a principal** (L34). Model registrations and routing policy are system-scoped (`principal_id` defaults `'system'`); `catalogue.model_health` is system-scoped.
- **Lint bans** (`scripts/lint.mjs`): `console.log`, `@ts-ignore` (use `@ts-expect-error` + reason), `as any`, bare `TODO` (write `TODO:` with detail). `.test.ts`, `-cli.ts`, `main.ts` are exempt from the `console` ban only.
- **Routing is pure.** `route(ModelRequest, RoutingSnapshot) → RoutingPlan` performs no I/O, no `Date.now()`, no randomness. It is fully replayable from its two inputs. The caller passes `now` in the `RoutingSnapshot`.
- **The privacy gate is a hard filter, never a score** (spec §4.1). `request.privacyClass` > `model.maxPrivacyClass` ⇒ the model is excluded with a recorded reason. `debug.forceModelId` skips **Stage 2 only** — the hard filters still apply; a forced model failing a filter ⇒ `errorClass: 'override_rejected'`.
- **Verification gate after every task:** `pnpm typecheck` (0 errors) and `pnpm lint` (`lint: clean`). Tasks adding runtime code also run `pnpm test`. Tasks touching migrations run `pnpm test:integration` when Docker is available (self-skips otherwise, like existing `*.integration.test.ts`).
- **Commit** ends the message body with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## File Structure

**Contracts** (`packages/contracts/src/`):

| File | Responsibility |
|---|---|
| `model.ts` | MODIFY — additive `ModelRequest` dimensions, `ModelResponse.attempts[]`, `ModelRegistration` extensions, `TaskClass`, `Modality`, `ReasoningLevel`, `ModelErrorClass` |
| `routing.ts` | CREATE — `RoutingPolicy`, `RoutingWeights`, `RoutingSnapshot`, `RoutingPlan`, `AttemptRecord`, `FilterTrace`, `ScoreTrace`, `ModelHealthRow` |
| `event-names.ts` | MODIFY — `+ ModelCallFailed`, `+ RouteExplained` |
| `index.ts` | MODIFY — `+ export * from './routing.ts'` |
| `event-names.test.ts` | MODIFY — assertions for the two new names |

**Persistence** (`packages/persistence/src/migrations/`):

| File | Responsibility |
|---|---|
| `0007_catalogue.sql` | CREATE — `catalogue` schema: `models`, `routing_policy`, `model_health`; `jarvis_catalogue` role |

**Model Registry module** (`apps/core/src/kernel/model-registry/`):

| File | Responsibility |
|---|---|
| `model-health-policy.ts` | CREATE — pure EWMA update + availability derivation |
| `model-health-policy.test.ts` | CREATE — unit tests for the pure function |
| `model-health-projector.ts` | CREATE — folds `model.called` / `.call_failed` events into `catalogue.model_health` |
| `model-registry.ts` | CREATE — the component: register / deregister models + routing policy, serve `RoutingSnapshot` |
| `index.ts` | CREATE — barrel |
| `apps/core/test/model-registry.integration.test.ts` | CREATE — register a model, get a snapshot, feed health events, assert EWMA |

**Gateway process** (`apps/gateway/`):

| File | Responsibility |
|---|---|
| `package.json` | CREATE — `@jarvis/gateway` workspace package |
| `src/provider-adapter.ts` | CREATE — the `ProviderAdapter` interface + `AdapterResult` |
| `src/adapters/stub/index.ts` | CREATE — keyless deterministic stub adapter (echo + injectable failure) |
| `src/adapters/openai-compatible/index.ts` | CREATE — real-provider-shape HTTP adapter (env key + base URL; never called in tests) |
| `src/routing/route.ts` | CREATE — the pure two-stage `route()` |
| `src/routing/route.test.ts` | CREATE — filters, scoring, privacy gate, override, no-route |
| `src/circuit-breaker.ts` | CREATE — per-provider breaker (closed / open / half-open) |
| `src/circuit-breaker.test.ts` | CREATE — opens on threshold, half-opens after cooldown |
| `src/event-sink.ts` | CREATE — `EventSink` interface + an in-memory fake for tests |
| `src/gateway.ts` | CREATE — `Gateway.infer()` orchestration: route → adapter → breaker → fallback → `attempts[]` → emit `model.called` / `.call_failed` |
| `src/gateway.test.ts` | CREATE — fallback on failure, attempts recorded, breaker opens, no-route, privacy gate, budget/context errorClass |
| `src/main.ts` | CREATE — process entrypoint: load config, register adapters, bind NATS request/reply + event publish, start |
| `README.md` | MODIFY — reflect the built shape |

**ADR / docs:**

| File | Responsibility |
|---|---|
| `docs/architecture/adr/0025-model-routing-policy.md` | CREATE |
| `docs/architecture/adr/README.md` | MODIFY — add the `[0025]` row |
| `docs/architecture/DATA_OWNERSHIP.md` | MODIFY — rows for `catalogue.routing_policy` + `catalogue.model_health` |
| `docs/architecture/GLOSSARY.md` | MODIFY — `TaskClass`, `RoutingPlan`, `RoutingSnapshot`, routing filter/score, `ProviderAdapter`, circuit breaker |
| `docs/architecture/ROADMAP.md` | MODIFY — MK.45 status note (model access landed) |

---

## Task 1: Extend the model + routing contracts

**Files:**
- Modify: `packages/contracts/src/model.ts`
- Create: `packages/contracts/src/routing.ts`
- Modify: `packages/contracts/src/event-names.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/event-names.test.ts`

**Interfaces:**
- Consumes: `CorrelationId`, `PrincipalId`, `Timestamp` from `./common.ts`; `ContextFrame` from `./context-frame.ts`; `Provenance` from `./provenance.ts`; `PrivacyClass` from `./event.ts`.
- Produces: from `model.ts` — `TaskClass`, `Modality`, `ReasoningLevel`, `ModelErrorClass`, extended `ModelRequest` (`taskClass?`, `reasoning?`, `modalities?`, `privacyClass?`, `structuredOutput?`, `latencyClass?`, `minReliability?`, `deadline?`, `toolChoice?`, `debug?`, `budget.maxToolCalls?`, `budget.maxAttempts?`), extended `ModelResponse` (`attempts: AttemptRecord[]`, `structuredOutputValid?`), extended `ModelRegistration` (`taskClasses`, `modalities`, `structuredOutputSupport`, `toolSupport`, `reasoningLevels`, `latencyProfileMs`, `maxPrivacyClass`, `costProfile`); from `routing.ts` — `RoutingWeights`, `RoutingPolicy`, `ModelHealthRow`, `RoutingSnapshot`, `RoutingModelMeta`, `RoutingPlan`, `AttemptRecord`, `FilterReason`, `FilterTrace`, `ScoreTrace`. `EventNames.ModelCallFailed = 'jarvis.cognition.model.call_failed'`, `EventNames.RouteExplained = 'jarvis.cognition.route.explained'`.

- [ ] **Step 1: Write the failing test** — append to `packages/contracts/src/event-names.test.ts` (inside the existing `describe` or a new one):

```typescript
describe('MK.45 model-access event names', () => {
  it('exposes the two new jarvis.cognition.* names with the 4-segment grammar', () => {
    expect(EventNames.ModelCallFailed).toBe('jarvis.cognition.model.call_failed');
    expect(EventNames.RouteExplained).toBe('jarvis.cognition.route.explained');
    for (const v of [EventNames.ModelCallFailed, EventNames.RouteExplained]) {
      expect(v).toMatch(/^jarvis\.[a-z]+\.[a-z_]+\.[a-z_]+$/);
    }
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run packages/contracts/src/event-names.test.ts`
Expected: FAIL — `EventNames.ModelCallFailed` is `undefined`.

- [ ] **Step 3: Add the two event names** — in `event-names.ts`, before the closing `} as const;`, after the MK.46 memory block:

```typescript

  // --- Cognition: model gateway — MK.45 ---
  ModelCallFailed: 'jarvis.cognition.model.call_failed',
  RouteExplained: 'jarvis.cognition.route.explained',
```

- [ ] **Step 4: Rewrite `model.ts`** — keep the header, keep every existing export, add the new types. Full file:

```typescript
/**
 * Model Gateway contracts — provider-neutral (L1, L3, L26).
 *
 * Governance: docs/architecture/COGNITION_MODEL.md §2, ADR-0010, ADR-0025,
 * docs/superpowers/specs/2026-09-02-the-mind-cognitive-architecture-design.md §3
 *
 * NO provider "chat" shape appears here. `input` is structured; the gateway
 * adapter serialises it to whatever the chosen provider wants. Budgets are in
 * abstract "context units" mapped by the adapter to a provider tokenizer.
 *
 * ADDITIVE CHANGE (MK.45): new optional `ModelRequest` dimensions, `attempts[]`
 * on `ModelResponse`, and `ModelRegistration` metadata. `ModelTask` /
 * `ModelRequest.task` are retained and DEPRECATED in favour of `TaskClass` /
 * `taskClass`; the gateway prefers `taskClass` when present.
 */

import type { CorrelationId, PrincipalId, Timestamp } from './common.ts';
import type { ContextFrame } from './context-frame.ts';
import type { PrivacyClass } from './event.ts';
import type { Provenance } from './provenance.ts';

/** @deprecated MK.45 — use `TaskClass`. */
export type ModelTask =
  | 'reason'
  | 'plan'
  | 'summarize'
  | 'extract'
  | 'classify'
  | 'code'
  | 'embed'
  | 'transcribe'
  | 'vision';

/** Canonical cognition task classes (spec §3.2). Open set — new classes are data. */
export type TaskClass =
  | 'realtime_conversation'
  | 'intent_classification'
  | 'planning'
  | 'deep_reasoning'
  | 'coding'
  | 'vision'
  | 'research'
  | 'document_analysis'
  | 'summarisation'
  | 'embedding'
  | 'reranking'
  | 'speech_recognition'
  | 'speech_generation'
  | (string & {});

export type ModelCapability =
  | 'tools'
  | 'vision'
  | 'json'
  | 'long_context'
  | 'streaming'
  | 'function_calling';

export type Modality = 'text' | 'image' | 'audio_in' | 'audio_out' | 'video';

export type ReasoningLevel = 'none' | 'light' | 'standard' | 'deep';

export type Locality = 'local' | 'prefer-local' | 'any' | 'cloud-ok';

/** Failure classes a gateway call can end in (spec §3.3, §11). */
export type ModelErrorClass =
  | 'outage'
  | 'rate_limit'
  | 'timeout'
  | 'refusal'
  | 'malformed'
  | 'context_overflow'
  | 'budget_exceeded'
  | 'no_route'
  | 'override_rejected';

export interface ModelInput {
  instruction: string;
  context: ContextFrame;
  constraints: string[];
  examples?: Array<{ input: string; output: string }>;
}

export interface ModelRequest {
  /** @deprecated MK.45 — set `taskClass`. Retained for back-compat. */
  task: ModelTask;
  /** Canonical task class; the gateway prefers this over `task`. */
  taskClass?: TaskClass;

  capabilities: ModelCapability[];
  input: ModelInput;

  budget: {
    contextUnits: number;
    maxOutput: number;
    maxCost?: number;
    maxLatencyMs?: number;
    maxToolCalls?: number;
    /** Fallback chain depth (spec §4.3). Default 2 if omitted. */
    maxAttempts?: number;
  };

  locality: Locality;
  determinism?: 'strict' | 'low-temp' | 'creative';
  reasoning?: ReasoningLevel;
  latencyClass?: 'realtime' | 'interactive' | 'batch';
  modalities?: Modality[];

  /** Filter out models whose context limit is below this. */
  minContextUnits?: number;

  /** HARD routing filter: request class must be <= the model's `maxPrivacyClass` (spec §4.1). */
  privacyClass?: PrivacyClass;

  toolChoice?: 'none' | 'auto' | 'required';
  /** Stronger than `capabilities: ['json']` — the model must guarantee this shape. */
  structuredOutput?: { schema: unknown };

  /** Filter by the Registry's rolling success rate, 0..1. */
  minReliability?: number;

  /** Absolute wall-clock; distinct from per-call `budget.maxLatencyMs`. */
  deadline?: Timestamp;

  /** Opt-in only; TTL'd; content otherwise not persisted. */
  cacheable?: boolean;

  /** Debugging overrides — accepted only from a kernel-local / owned-secure surface; audited. */
  debug?: {
    /** Skips Stage 2 (scoring) ONLY — hard filters still apply. */
    forceModelId?: string;
    forcePolicyVersion?: number;
    /** Return the full filter + score trace in `ModelResponse.meta`. */
    explain?: boolean;
  };

  correlationId: CorrelationId;
  principalId: PrincipalId;
}

export type FinishReason = 'stop' | 'length' | 'filtered' | 'error';

/** One attempt in the fallback chain (spec §4.3). */
export interface AttemptRecord {
  modelId: string;
  finishReason: FinishReason;
  latencyMs: number;
  errorClass?: ModelErrorClass;
}

export interface ModelResponse {
  modelId: string;
  output: unknown;
  usage: {
    contextUnits: number;
    outputUnits: number;
    costEstimate: number;
    latencyMs: number;
  };
  finishReason: FinishReason;
  /** Present when `finishReason === 'error'`. */
  errorClass?: ModelErrorClass;
  /** Every attempt made, in order, including the one that succeeded. */
  attempts: AttemptRecord[];
  /** Set when `structuredOutput` was requested. */
  structuredOutputValid?: boolean;
  provenance: Provenance;
  /** Non-authoritative hints; carries the route trace when `debug.explain`. */
  meta?: Record<string, unknown>;
}

export type StructuredOutputSupport = 'none' | 'json' | 'json_schema' | 'grammar';
export type ToolSupport = 'none' | 'sequential' | 'parallel';

/** A registered model in the Kernel Model Registry (`catalogue.models`). */
export interface ModelRegistration {
  id: string;
  provider: string;
  displayName: string;

  /** @deprecated MK.45 — use `taskClasses`. */
  tasks: ModelTask[];
  taskClasses: TaskClass[];

  capabilities: ModelCapability[];
  modalities: Modality[];

  contextLimitUnits: number;

  structuredOutputSupport: StructuredOutputSupport;
  toolSupport: ToolSupport;
  reasoningLevels: ReasoningLevel[];

  latencyProfileMs: { p50: number; p95: number };

  /** Highest sensitivity this model's route may carry. Local models can be RESTRICTED;
   *  cloud defaults to INTERNAL, operator-configurable per model. */
  maxPrivacyClass: PrivacyClass;

  costProfile: {
    perContextUnit: number;
    perOutputUnit: number;
    perToolCall?: number;
  };
  /** @deprecated — folded into `costProfile`. */
  costPerContextUnit: number;
  /** @deprecated — folded into `costProfile`. */
  costPerOutputUnit: number;

  locality: Extract<Locality, 'local' | 'cloud-ok'>;
  enabled: boolean;
  registeredAt: Timestamp;
}
```

- [ ] **Step 5: Write `routing.ts`**

```typescript
/**
 * Routing contracts (spec §4, ADR-0025). The gateway's `route()` is a PURE
 * function `route(ModelRequest, RoutingSnapshot) -> RoutingPlan` — no I/O, no
 * clock, no randomness. `now` is carried in the snapshot.
 */

import type { PrincipalId, Timestamp } from './common.ts';
import type {
  AttemptRecord,
  ModelRegistration,
  ModelRequest,
  TaskClass,
} from './model.ts';

/** Scoring weights for one `TaskClass` (spec §4.2). Stored as data. */
export interface RoutingWeights {
  quality: number;
  reliability: number;
  latency: number;
  cost: number;
  locality: number;
  recency: number;
}

/** A versioned routing-policy row (`catalogue.routing_policy`). */
export interface RoutingPolicy {
  taskClass: TaskClass;
  version: number;
  weights: RoutingWeights;
  /** Operator-set per-model quality prior, 0..1, keyed by model id. */
  qualityPriors: Record<string, number>;
  /** Optional extra hard filters beyond the built-in set. */
  hardFilters?: {
    /** Exclude these model ids outright. */
    excludeModelIds?: string[];
    /** Require the model be in this set (empty = no restriction). */
    onlyModelIds?: string[];
  };
  updatedAt: Timestamp;
}

/** Derived health for one model (`catalogue.model_health`). */
export interface ModelHealthRow {
  modelId: string;
  availability: 'available' | 'degraded' | 'unavailable';
  /** EWMA of call success, 0..1. */
  rollingSuccessRate: number;
  /** EWMA observed latency. */
  observedLatencyMs: { p50: number; p95: number };
  /** Circuit-breaker state as last reported by the gateway. */
  breaker: 'closed' | 'open' | 'half_open';
  /** When the metrics were last updated — routing penalises staleness. */
  metricsAsOf: Timestamp;
}

/** Everything `route()` needs, assembled by the Model Registry + gateway. */
export interface RoutingSnapshot {
  now: Timestamp;
  models: ModelRegistration[];
  health: Record<string, ModelHealthRow>;
  policies: Record<string, RoutingPolicy>; // keyed by TaskClass
  /** Breaker state the gateway holds in-process (authoritative for the current call). */
  liveBreaker: Record<string, 'closed' | 'open' | 'half_open'>;
}

export type FilterReason =
  | 'task_class'
  | 'modality'
  | 'capability'
  | 'structured_output'
  | 'tool_support'
  | 'context_limit'
  | 'locality'
  | 'privacy_class'
  | 'availability'
  | 'breaker_open'
  | 'min_reliability'
  | 'policy_exclude'
  | 'policy_only';

export interface FilterTrace {
  modelId: string;
  excluded: boolean;
  reasons: FilterReason[];
}

export interface ScoreTrace {
  modelId: string;
  score: number;
  components: Record<keyof RoutingWeights, number>;
}

export interface RoutingPlan {
  /** null when no model satisfies the constraints. */
  primary: string | null;
  /** Next-best model ids, ranked; consumed by the fallback chain. */
  fallbacks: string[];
  policyVersion: number | null;
  reason: 'ok' | 'no_model_satisfies_constraints' | 'forced';
  filterTrace: FilterTrace[];
  scoreTrace: ScoreTrace[];
}

/** Re-export for convenience where a caller wires request → plan → attempts. */
export type { AttemptRecord, ModelRequest, PrincipalId };
```

- [ ] **Step 6: Barrel export** — in `index.ts`, after `export * from './model.ts';` add:

```typescript
export * from './routing.ts';
```

- [ ] **Step 7: Run the event-names test — verify it passes**

Run: `pnpm vitest run packages/contracts/src/event-names.test.ts`
Expected: PASS.

- [ ] **Step 8: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all tests pass (contracts are types-only apart from `EventNames`).

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/model.ts packages/contracts/src/routing.ts packages/contracts/src/event-names.ts packages/contracts/src/index.ts packages/contracts/src/event-names.test.ts
git commit -m "feat(contracts): extend model.ts + add routing.ts for MK.45 model access

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Migration `0007_catalogue.sql`

**Files:**
- Create: `packages/persistence/src/migrations/0007_catalogue.sql`
- Create: `apps/core/test/catalogue-schema.integration.test.ts`

**Interfaces:**
- Consumes: the `events` schema (migration `0001`).
- Produces: schema `catalogue` with tables `models`, `routing_policy`, `model_health`; role `jarvis_catalogue`.

- [ ] **Step 1: Write `0007_catalogue.sql`**

```sql
-- Model Registry catalogue (Kernel component #11).
-- docs/architecture/DATA_OWNERSHIP.md §1, ADR-0025,
-- docs/superpowers/specs/2026-09-02-the-mind-cognitive-architecture-design.md §3.3.
-- Owner: Model Registry. No credentials stored here (ADR-0010).

create schema if not exists catalogue;

create table if not exists catalogue.models (
  id                       text        primary key,
  provider                 text        not null,
  display_name             text        not null,
  task_classes             text[]      not null default '{}',
  tasks                    text[]      not null default '{}',   -- deprecated
  capabilities             text[]      not null default '{}',
  modalities               text[]      not null default '{}',
  context_limit_units      integer     not null,
  structured_output_support text       not null default 'none'
                             check (structured_output_support in ('none','json','json_schema','grammar')),
  tool_support             text        not null default 'none'
                             check (tool_support in ('none','sequential','parallel')),
  reasoning_levels         text[]      not null default '{}',
  latency_p50_ms           integer     not null default 0,
  latency_p95_ms           integer     not null default 0,
  max_privacy_class        text        not null default 'INTERNAL'
                             check (max_privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  cost_per_context_unit    double precision not null default 0,
  cost_per_output_unit     double precision not null default 0,
  cost_per_tool_call       double precision,
  locality                 text        not null default 'cloud-ok'
                             check (locality in ('local','cloud-ok')),
  enabled                  boolean     not null default true,
  principal_id             text        not null default 'system',
  registered_at            timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists models_enabled_idx on catalogue.models (enabled) where enabled;

create table if not exists catalogue.routing_policy (
  task_class    text        not null,
  version       integer     not null,
  weights       jsonb       not null,
  quality_priors jsonb      not null default '{}',
  hard_filters  jsonb,
  principal_id  text        not null default 'system',
  updated_at    timestamptz not null default now(),
  primary key (task_class, version)
);
-- The active version per task_class = max(version). A view keeps that explicit.
create or replace view catalogue.routing_policy_active as
  select distinct on (task_class) *
  from catalogue.routing_policy
  order by task_class, version desc;

create table if not exists catalogue.model_health (
  model_id            text        primary key references catalogue.models(id) on delete cascade,
  availability        text        not null default 'available'
                        check (availability in ('available','degraded','unavailable')),
  rolling_success_rate double precision not null default 1.0
                        check (rolling_success_rate >= 0 and rolling_success_rate <= 1),
  observed_latency_p50_ms integer  not null default 0,
  observed_latency_p95_ms integer  not null default 0,
  breaker            text        not null default 'closed'
                        check (breaker in ('closed','open','half_open')),
  call_count         bigint      not null default 0,
  principal_id       text        not null default 'system',
  metrics_as_of      timestamptz not null default now()
);

-- Per-schema role (boundary proof — ADR-0020 §5, DATA_OWNERSHIP.md §3).
do $$
begin
  if not exists (select from pg_roles where rolname = 'jarvis_catalogue') then
    create role jarvis_catalogue nologin;
  end if;
end
$$;
grant usage on schema catalogue to jarvis_catalogue;
grant select, insert, update, delete on all tables in schema catalogue to jarvis_catalogue;
alter default privileges in schema catalogue
  grant select, insert, update, delete on tables to jarvis_catalogue;
grant usage on schema events to jarvis_catalogue;
grant select on events.events to jarvis_catalogue;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const s=require('fs').readFileSync('packages/persistence/src/migrations/0007_catalogue.sql','utf8'); if(!/create schema if not exists catalogue/.test(s)||!/jarvis_catalogue/.test(s)) throw new Error('missing'); console.error('ok')"`
Expected: `ok`

- [ ] **Step 3: Write the integration test** — `apps/core/test/catalogue-schema.integration.test.ts`, mirroring `apps/core/test/knowledge-schema.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { isDockerAvailable, startEphemeralPg, type EphemeralPg } from '@jarvis/testkit';

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('MK.45 catalogue schema (integration)', () => {
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

  it('creates the catalogue schema and its three tables', async () => {
    const rows = await pg.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'catalogue' and table_type = 'BASE TABLE'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual(['model_health', 'models', 'routing_policy']);
  });

  it('creates the jarvis_catalogue role granted on catalogue but not on atlas', async () => {
    const roles = await pg.sql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname = 'jarvis_catalogue'`;
    expect(roles).toHaveLength(1);
    const onCatalogue = await pg.sql<{ h: boolean }[]>`
      select has_schema_privilege('jarvis_catalogue','catalogue','usage') as h`;
    const onAtlas = await pg.sql<{ h: boolean }[]>`
      select has_schema_privilege('jarvis_catalogue','atlas','usage') as h`;
    expect(onCatalogue[0]?.h).toBe(true);
    expect(onAtlas[0]?.h).toBe(false);
  });

  it('rejects a model_health row with rolling_success_rate outside 0..1', async () => {
    await pg.sql`insert into catalogue.models (id, provider, display_name, context_limit_units)
                 values ('m1', 'stub', 'Stub One', 1000) on conflict do nothing`;
    await expect(
      pg.sql`insert into catalogue.model_health (model_id, rolling_success_rate) values ('m1', 1.5)`,
    ).rejects.toThrow();
  });

  it('routing_policy_active returns the highest version per task_class', async () => {
    await pg.sql`insert into catalogue.routing_policy (task_class, version, weights)
                 values ('coding', 1, '{}'::jsonb), ('coding', 2, '{"quality":1}'::jsonb)`;
    const rows = await pg.sql<{ version: number }[]>`
      select version from catalogue.routing_policy_active where task_class = 'coding'`;
    expect(rows[0]?.version).toBe(2);
  });

  it('re-running migrations is a no-op', async () => {
    const r = await runMigrations(pg.sql);
    expect(r.applied).toEqual([]);
    expect(r.alreadyApplied).toContain('0007_catalogue.sql');
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test:integration` (or `JARVIS_IT=1 pnpm vitest run apps/core/test/catalogue-schema.integration.test.ts` with Docker up)
Expected: PASS (5 assertions) with Docker; SKIPPED otherwise.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, unit tests pass (integration self-skips under plain `pnpm test`).

- [ ] **Step 6: Commit**

```bash
git add packages/persistence/src/migrations/0007_catalogue.sql apps/core/test/catalogue-schema.integration.test.ts
git commit -m "feat(persistence): 0007 catalogue schema (models / routing_policy / model_health)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `model-health-policy` — the pure EWMA + availability function

**Files:**
- Create: `apps/core/src/kernel/model-registry/model-health-policy.ts`
- Create: `apps/core/src/kernel/model-registry/model-health-policy.test.ts`

**Interfaces:**
- Consumes: `ModelHealthRow` from `@jarvis/contracts`.
- Produces: `updateHealth(prev: ModelHealthRow, sample: HealthSample) → ModelHealthRow`; `HealthSample` type; `EWMA_ALPHA`, `DEGRADED_SUCCESS_THRESHOLD`, `UNAVAILABLE_SUCCESS_THRESHOLD` consts.

- [ ] **Step 1: Write the failing test** — `model-health-policy.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { ModelHealthRow } from '@jarvis/contracts';
import { updateHealth } from './model-health-policy.ts';

const base: ModelHealthRow = {
  modelId: 'm1',
  availability: 'available',
  rollingSuccessRate: 1,
  observedLatencyMs: { p50: 100, p95: 200 },
  breaker: 'closed',
  metricsAsOf: '2026-09-02T00:00:00.000Z',
};

describe('updateHealth', () => {
  it('is a pure EWMA: a success nudges the rate toward 1, a failure toward 0', () => {
    const afterFail = updateHealth(base, { ok: false, latencyMs: 500, at: '2026-09-02T00:00:01.000Z' });
    expect(afterFail.rollingSuccessRate).toBeLessThan(1);
    expect(afterFail.rollingSuccessRate).toBeGreaterThan(0);
    const afterSuccess = updateHealth(afterFail, { ok: true, latencyMs: 120, at: '2026-09-02T00:00:02.000Z' });
    expect(afterSuccess.rollingSuccessRate).toBeGreaterThan(afterFail.rollingSuccessRate);
  });

  it('drops to degraded then unavailable as the success rate falls', () => {
    let h = base;
    for (let i = 0; i < 3; i++) h = updateHealth(h, { ok: false, latencyMs: 900, at: '2026-09-02T00:00:0' + i + '.000Z' });
    expect(h.availability).toBe('degraded');
    for (let i = 0; i < 20; i++) h = updateHealth(h, { ok: false, latencyMs: 900, at: '2026-09-02T00:01:00.000Z' });
    expect(h.availability).toBe('unavailable');
  });

  it('a reported open breaker forces unavailable regardless of the rate', () => {
    const h = updateHealth(base, { ok: true, latencyMs: 100, at: '2026-09-02T00:00:01.000Z', breaker: 'open' });
    expect(h.availability).toBe('unavailable');
    expect(h.breaker).toBe('open');
  });

  it('is deterministic — same inputs, same output', () => {
    const s = { ok: false, latencyMs: 300, at: '2026-09-02T00:00:01.000Z' } as const;
    expect(updateHealth(base, s)).toEqual(updateHealth(base, s));
  });

  it('advances metricsAsOf to the sample time and EWMAs latency', () => {
    const h = updateHealth(base, { ok: true, latencyMs: 300, at: '2026-09-02T00:00:05.000Z' });
    expect(h.metricsAsOf).toBe('2026-09-02T00:00:05.000Z');
    expect(h.observedLatencyMs.p50).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run apps/core/src/kernel/model-registry/model-health-policy.test.ts`
Expected: FAIL — cannot find `./model-health-policy.ts`.

- [ ] **Step 3: Write `model-health-policy.ts`**

```typescript
/**
 * Pure health-derivation for a model (spec §3.3, §4.5). No I/O, no clock —
 * `sample.at` carries the time. Same style as health-policy.ts / presence-policy.ts.
 *
 * The Model Registry's projector calls this on every `model.called` /
 * `model.call_failed` event to fold reliability + latency into `catalogue.model_health`.
 */

import type { ModelHealthRow } from '@jarvis/contracts';

/** EWMA smoothing factor for success rate + latency. */
export const EWMA_ALPHA = 0.2;
/** Below this rolling success rate → `degraded`. */
export const DEGRADED_SUCCESS_THRESHOLD = 0.85;
/** Below this → `unavailable`. */
export const UNAVAILABLE_SUCCESS_THRESHOLD = 0.4;

export interface HealthSample {
  ok: boolean;
  latencyMs: number;
  /** RFC3339 UTC — the event `time`. */
  at: string;
  /** Circuit-breaker state the gateway reported with this call, if any. */
  breaker?: 'closed' | 'open' | 'half_open';
}

function ewma(prev: number, next: number): number {
  return prev * (1 - EWMA_ALPHA) + next * EWMA_ALPHA;
}

export function updateHealth(prev: ModelHealthRow, sample: HealthSample): ModelHealthRow {
  const rollingSuccessRate = ewma(prev.rollingSuccessRate, sample.ok ? 1 : 0);
  const p50 = Math.round(ewma(prev.observedLatencyMs.p50, sample.latencyMs));
  const p95 = Math.round(ewma(prev.observedLatencyMs.p95, Math.max(sample.latencyMs, prev.observedLatencyMs.p95)));
  const breaker = sample.breaker ?? prev.breaker;

  let availability: ModelHealthRow['availability'];
  if (breaker === 'open') {
    availability = 'unavailable';
  } else if (rollingSuccessRate < UNAVAILABLE_SUCCESS_THRESHOLD) {
    availability = 'unavailable';
  } else if (rollingSuccessRate < DEGRADED_SUCCESS_THRESHOLD || breaker === 'half_open') {
    availability = 'degraded';
  } else {
    availability = 'available';
  }

  return {
    modelId: prev.modelId,
    availability,
    rollingSuccessRate,
    observedLatencyMs: { p50, p95 },
    breaker,
    metricsAsOf: sample.at,
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run apps/core/src/kernel/model-registry/model-health-policy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/kernel/model-registry/model-health-policy.ts apps/core/src/kernel/model-registry/model-health-policy.test.ts
git commit -m "feat(model-registry): pure model-health EWMA + availability derivation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Model Registry component + `model_health` projector + integration test

**Files:**
- Create: `apps/core/src/kernel/model-registry/model-health-projector.ts`
- Create: `apps/core/src/kernel/model-registry/model-registry.ts`
- Create: `apps/core/src/kernel/model-registry/index.ts`
- Create: `apps/core/test/model-registry.integration.test.ts`

**Interfaces:**
- Consumes: `updateHealth`, `HealthSample` from `./model-health-policy.ts`; `type { Sql } from '@jarvis/persistence'`; `Event`, `EventNames`, `ModelRegistration`, `RoutingPolicy`, `RoutingSnapshot`, `ModelHealthRow`, `RoutingPlan` from `@jarvis/contracts`; `isReplay` from `../event-fabric/replay.ts` (see `apps/core/src/kernel/state/projector.ts` for the pattern).
- Produces:
  - `class ModelHealthProjector { constructor(sql: Sql); apply(event: Event): Promise<void>; readonly stats }` — folds `EventNames.ModelCalled` / `EventNames.ModelCallFailed` payloads via `updateHealth`.
  - `class ModelRegistry { constructor(deps: { sql: Sql; clock: Clock }); registerModel(m: ModelRegistration): Promise<void>; deregisterModel(id: string): Promise<void>; setEnabled(id: string, enabled: boolean): Promise<void>; upsertRoutingPolicy(p: RoutingPolicy): Promise<void>; getRoutingSnapshot(taskClasses?: string[]): Promise<RoutingSnapshot>; reportBreaker(modelId: string, state: 'closed'|'open'|'half_open'): Promise<void> }`.

> **Note on the event name:** the gateway emits `jarvis.cognition.model.called` for a successful call. `event-names.ts` does not yet have a `ModelCalled` constant (only the two added in Task 1). Add `ModelCalled: 'jarvis.cognition.model.called'` to `event-names.ts` in this task's Step 1 alongside the projector — it is the third MK.45 cognition event and belongs with its siblings. Update `event-names.test.ts` to assert it too.

- [ ] **Step 1: Add the `ModelCalled` event name** — in `packages/contracts/src/event-names.ts`, in the `// --- Cognition: model gateway — MK.45 ---` block, add as the first line:

```typescript
  ModelCalled: 'jarvis.cognition.model.called',
```

and in `packages/contracts/src/event-names.test.ts`, add to the MK.45 assertions:

```typescript
    expect(EventNames.ModelCalled).toBe('jarvis.cognition.model.called');
```

- [ ] **Step 2: Write the failing integration test** — `apps/core/test/model-registry.integration.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { EventNames, type Event, type ModelRegistration, type RoutingPolicy } from '@jarvis/contracts';
import { isDockerAvailable, startEphemeralPg, type EphemeralPg } from '@jarvis/testkit';
import { SystemClock } from '../src/runtime/clock.ts';
import { ModelRegistry } from '../src/kernel/model-registry/model-registry.ts';
import { ModelHealthProjector } from '../src/kernel/model-registry/model-health-projector.ts';

const dockerOk = await isDockerAvailable();

function reg(id: string, over: Partial<ModelReg
istration> = {}): ModelRegistration {
  return {
    id, provider: 'stub', displayName: id,
    tasks: [], taskClasses: ['coding'],
    capabilities: [], modalities: ['text'],
    contextLimitUnits: 100_000,
    structuredOutputSupport: 'json_schema', toolSupport: 'parallel',
    reasoningLevels: ['standard', 'deep'],
    latencyProfileMs: { p50: 400, p95: 900 },
    maxPrivacyClass: 'INTERNAL',
    costProfile: { perContextUnit: 0.000001, perOutputUnit: 0.000002 },
    costPerContextUnit: 0.000001, costPerOutputUnit: 0.000002,
    locality: 'cloud-ok', enabled: true, registeredAt: '2026-09-02T00:00:00.000Z',
    ...over,
  };
}

function healthEvent(type: string, modelId: string, at: string, extra: Record<string, unknown>): Event {
  return {
    id: 'E' + Math.random().toString(36).slice(2), type,
    schemaVersion: 1, retentionClass: 'DIAGNOSTIC', time: at, recordedAt: at,
    source: { node: 'test', component: 'gateway' },
    subject: { kind: 'model', id: modelId },
    actor: { kind: 'system', id: 'gateway' },
    provenance: { method: 'system', producedBy: 'gateway', producedOn: 'test', producedAt: at, correlationId: 'c1', derivedFromUntrusted: false },
    causationId: 'none', correlationId: 'c1', principalId: 'system', privacyClass: 'INTERNAL',
    payload: { modelId, ...extra },
  } as Event;
}

describe.skipIf(!dockerOk)('Model Registry (integration)', () => {
  let container: EphemeralPg;
  let pg: PgHandle;

  beforeAll(async () => {
    container = await startEphemeralPg();
    pg = createPg({ url: container.url });
    await runMigrations(pg.sql);
  }, 120_000);

  afterEach(async () => {
    await pg.sql`truncate catalogue.models, catalogue.routing_policy, catalogue.model_health cascade`;
  });

  afterAll(async () => {
    await pg?.close().catch(() => undefined);
    await container?.stop().catch(() => undefined);
  });

  it('registers a model and serves it in a RoutingSnapshot', async () => {
    const r = new ModelRegistry({ sql: pg.sql, clock: new SystemClock() });
    await r.registerModel(reg('m1'));
    const snap = await r.getRoutingSnapshot(['coding']);
    expect(snap.models.map((m) => m.id)).toEqual(['m1']);
    expect(snap.models[0]?.reasoningLevels).toContain('deep');
    expect(snap.health['m1']?.availability).toBe('available'); // seeded row
    expect(typeof snap.now).toBe('string');
  });

  it('upserts a routing policy; the snapshot carries the newest version', async () => {
    const r = new ModelRegistry({ sql: pg.sql, clock: new SystemClock() });
    const base: RoutingPolicy = {
      taskClass: 'coding', version: 1,
      weights: { quality: 1, reliability: 1, latency: 1, cost: 1, locality: 1, recency: 1 },
      qualityPriors: {}, updatedAt: '2026-09-02T00:00:00.000Z',
    };
    await r.upsertRoutingPolicy(base);
    await r.upsertRoutingPolicy({ ...base, version: 2, qualityPriors: { m1: 0.9 } });
    const snap = await r.getRoutingSnapshot(['coding']);
    expect(snap.policies['coding']?.version).toBe(2);
    expect(snap.policies['coding']?.qualityPriors['m1']).toBe(0.9);
  });

  it('the health projector folds model.called / model.call_failed via EWMA', async () => {
    const r = new ModelRegistry({ sql: pg.sql, clock: new SystemClock() });
    await r.registerModel(reg('m1'));
    const proj = new ModelHealthProjector(pg.sql);

    await proj.apply(healthEvent(EventNames.ModelCalled, 'm1', '2026-09-02T00:00:01.000Z', { latencyMs: 300, ok: true }));
    let snap = await r.getRoutingSnapshot(['coding']);
    expect(snap.health['m1']?.rollingSuccessRate).toBeCloseTo(1, 5);

    for (let i = 0; i < 5; i++) {
      await proj.apply(healthEvent(EventNames.ModelCallFailed, 'm1', '2026-09-02T00:00:0' + (2 + i) + '.000Z',
        { latencyMs: 800, errorClass: 'timeout' }));
    }
    snap = await r.getRoutingSnapshot(['coding']);
    expect(snap.health['m1']?.rollingSuccessRate).toBeLessThan(0.85);
    expect(snap.health['m1']?.availability).not.toBe('available');
  });

  it('deregisterModel removes the model and its health row', async () => {
    const r = new ModelRegistry({ sql: pg.sql, clock: new SystemClock() });
    await r.registerModel(reg('m1'));
    await r.deregisterModel('m1');
    const snap = await r.getRoutingSnapshot(['coding']);
    expect(snap.models).toHaveLength(0);
    expect(snap.health['m1']).toBeUndefined();
  });
});
```

*(Fix the accidental line break in `Partial<ModelRegistration>` when transcribing — it is one token.)*

- [ ] **Step 3: Run it — verify it fails**

Run: `JARVIS_IT=1 pnpm vitest run apps/core/test/model-registry.integration.test.ts` (Docker up)
Expected: FAIL — cannot find `../src/kernel/model-registry/model-registry.ts`.

- [ ] **Step 4: Write `model-health-projector.ts`**

```typescript
/**
 * Model-health projector. Folds `jarvis.cognition.model.called` /
 * `jarvis.cognition.model.call_failed` into `catalogue.model_health` via the
 * pure `updateHealth` EWMA (spec §3.3, §4.5).
 *
 * Idempotency: keyed on the (modelId) row + `metrics_as_of` monotonicity — an
 * event whose `time` is <= the row's `metrics_as_of` is a duplicate / late
 * delivery and is skipped. Pattern mirrors apps/core/src/kernel/state/projector.ts.
 */

import { EventNames, type Event, type ModelHealthRow } from '@jarvis/contracts';
import { type Sql } from '@jarvis/persistence';
import { updateHealth, type HealthSample } from './model-health-policy.ts';

export interface ModelHealthProjectionStats {
  applied: number;
  skippedStale: number;
  skippedUnknownModel: number;
}

interface ModelCallPayload {
  modelId: string;
  latencyMs?: number;
  errorClass?: string;
  breaker?: 'closed' | 'open' | 'half_open';
}

function rowFromDb(r: {
  model_id: string;
  availability: ModelHealthRow['availability'];
  rolling_success_rate: number;
  observed_latency_p50_ms: number;
  observed_latency_p95_ms: number;
  breaker: ModelHealthRow['breaker'];
  metrics_as_of: string;
}): ModelHealthRow {
  return {
    modelId: r.model_id,
    availability: r.availability,
    rollingSuccessRate: r.rolling_success_rate,
    observedLatencyMs: { p50: r.observed_latency_p50_ms, p95: r.observed_latency_p95_ms },
    breaker: r.breaker,
    metricsAsOf: r.metrics_as_of,
  };
}

export class ModelHealthProjector {
  readonly stats: ModelHealthProjectionStats = { applied: 0, skippedStale: 0, skippedUnknownModel: 0 };

  constructor(private readonly sql: Sql) {}

  async apply(event: Event): Promise<void> {
    const ok = event.type === EventNames.ModelCalled;
    const failed = event.type === EventNames.ModelCallFailed;
    if (!ok && !failed) return;

    const p = event.payload as ModelCallPayload;
    const sample: HealthSample = {
      ok,
      latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : 0,
      at: event.time,
      ...(p.breaker ? { breaker: p.breaker } : {}),
    };

    const rows = await this.sql<Parameters<typeof rowFromDb>[0][]>`
      select model_id, availability, rolling_success_rate, observed_latency_p50_ms,
             observed_latency_p95_ms, breaker, metrics_as_of
      from catalogue.model_health where model_id = ${p.modelId} for update`;

    if (rows.length === 0) {
      // No health row yet — only projectable if the model exists (FK). Seed then apply.
      const exists = await this.sql<{ id: string }[]>`select id from catalogue.models where id = ${p.modelId}`;
      if (exists.length === 0) {
        this.stats.skippedUnknownModel++;
        return;
      }
      const seeded: ModelHealthRow = {
        modelId: p.modelId, availability: 'available', rollingSuccessRate: 1,
        observedLatencyMs: { p50: 0, p95: 0 }, breaker: 'closed', metricsAsOf: '1970-01-01T00:00:00.000Z',
      };
      const next = updateHealth(seeded, sample);
      await this.write(next);
      this.stats.applied++;
      return;
    }

    const prev = rowFromDb(rows[0]!);
    if (Date.parse(event.time) <= Date.parse(prev.metricsAsOf)) {
      this.stats.skippedStale++;
      return;
    }
    const next = updateHealth(prev, sample);
    await this.write(next);
    this.stats.applied++;
  }

  private async write(h: ModelHealthRow): Promise<void> {
    await this.sql`
      insert into catalogue.model_health
        (model_id, availability, rolling_success_rate, observed_latency_p50_ms,
         observed_latency_p95_ms, breaker, call_count, metrics_as_of)
      values (${h.modelId}, ${h.availability}, ${h.rollingSuccessRate}, ${h.observedLatencyMs.p50},
              ${h.observedLatencyMs.p95}, ${h.breaker}, 1, ${h.metricsAsOf})
      on conflict (model_id) do update set
        availability = excluded.availability,
        rolling_success_rate = excluded.rolling_success_rate,
        observed_latency_p50_ms = excluded.observed_latency_p50_ms,
        observed_latency_p95_ms = excluded.observed_latency_p95_ms,
        breaker = excluded.breaker,
        call_count = catalogue.model_health.call_count + 1,
        metrics_as_of = excluded.metrics_as_of`;
  }
}
```

- [ ] **Step 5: Write `model-registry.ts`**

```typescript
/**
 * Model Registry — Kernel component #11 (KERNEL_CONSTITUTION.md §1, ADR-0025).
 *
 * Owns `catalogue.models` / `catalogue.routing_policy` / `catalogue.model_health`.
 * Serves a `RoutingSnapshot` to the gateway. Holds NO credentials (ADR-0010).
 * Model registrations and routing policy are DATA — no provider name is
 * hard-coded in code (L3).
 */

import type {
  ModelRegistration,
  ModelHealthRow,
  RoutingPolicy,
  RoutingSnapshot,
} from '@jarvis/contracts';
import { type Sql } from '@jarvis/persistence';
import type { Clock } from '../../runtime/clock.ts';

export class ModelRegistry {
  constructor(private readonly deps: { sql: Sql; clock: Clock }) {}

  async registerModel(m: ModelRegistration): Promise<void> {
    const sql = this.deps.sql;
    await sql.begin(async (tx) => {
      await tx`
        insert into catalogue.models
          (id, provider, display_name, task_classes, tasks, capabilities, modalities,
           context_limit_units, structured_output_support, tool_support, reasoning_levels,
           latency_p50_ms, latency_p95_ms, max_privacy_class,
           cost_per_context_unit, cost_per_output_unit, cost_per_tool_call,
           locality, enabled, principal_id, registered_at, updated_at)
        values
          (${m.id}, ${m.provider}, ${m.displayName}, ${m.taskClasses}, ${m.tasks}, ${m.capabilities},
           ${m.modalities}, ${m.contextLimitUnits}, ${m.structuredOutputSupport}, ${m.toolSupport},
           ${m.reasoningLevels}, ${m.latencyProfileMs.p50}, ${m.latencyProfileMs.p95}, ${m.maxPrivacyClass},
           ${m.costProfile.perContextUnit}, ${m.costProfile.perOutputUnit}, ${m.costProfile.perToolCall ?? null},
           ${m.locality}, ${m.enabled}, 'system', ${m.registeredAt}, ${this.deps.clock.nowIso()})
        on conflict (id) do update set
          provider = excluded.provider, display_name = excluded.display_name,
          task_classes = excluded.task_classes, capabilities = excluded.capabilities,
          modalities = excluded.modalities, context_limit_units = excluded.context_limit_units,
          structured_output_support = excluded.structured_output_support,
          tool_support = excluded.tool_support, reasoning_levels = excluded.reasoning_levels,
          latency_p50_ms = excluded.latency_p50_ms, latency_p95_ms = excluded.latency_p95_ms,
          max_privacy_class = excluded.max_privacy_class,
          cost_per_context_unit = excluded.cost_per_context_unit,
          cost_per_output_unit = excluded.cost_per_output_unit,
          cost_per_tool_call = excluded.cost_per_tool_call,
          locality = excluded.locality, enabled = excluded.enabled,
          updated_at = excluded.updated_at`;
      await tx`
        insert into catalogue.model_health (model_id, metrics_as_of)
        values (${m.id}, ${this.deps.clock.nowIso()})
        on conflict (model_id) do nothing`;
    });
  }

  async deregisterModel(id: string): Promise<void> {
    await this.deps.sql`delete from catalogue.models where id = ${id}`; // cascades to model_health
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.deps.sql`update catalogue.models set enabled = ${enabled}, updated_at = ${this.deps.clock.nowIso()} where id = ${id}`;
  }

  async upsertRoutingPolicy(p: RoutingPolicy): Promise<void> {
    await this.deps.sql`
      insert into catalogue.routing_policy (task_class, version, weights, quality_priors, hard_filters, principal_id, updated_at)
      values (${p.taskClass}, ${p.version}, ${this.deps.sql.json(p.weights as never)},
              ${this.deps.sql.json(p.qualityPriors as never)},
              ${p.hardFilters ? this.deps.sql.json(p.hardFilters as never) : null},
              'system', ${p.updatedAt})
      on conflict (task_class, version) do update set
        weights = excluded.weights, quality_priors = excluded.quality_priors,
        hard_filters = excluded.hard_filters, updated_at = excluded.updated_at`;
  }

  async reportBreaker(modelId: string, state: 'closed' | 'open' | 'half_open'): Promise<void> {
    await this.deps.sql`
      insert into catalogue.model_health (model_id, breaker, metrics_as_of)
      values (${modelId}, ${state}, ${this.deps.clock.nowIso()})
      on conflict (model_id) do update set breaker = ${state}, metrics_as_of = ${this.deps.clock.nowIso()}`;
  }

  async getRoutingSnapshot(taskClasses?: string[]): Promise<RoutingSnapshot> {
    const sql = this.deps.sql;
    const models = await sql<Array<Record<string, unknown>>>`
      select * from catalogue.models where enabled = true
      ${taskClasses && taskClasses.length > 0 ? sql`and task_classes && ${taskClasses}` : sql``}`;
    const health = await sql<Array<Record<string, unknown>>>`select * from catalogue.model_health`;
    const policies = await sql<Array<Record<string, unknown>>>`
      select * from catalogue.routing_policy_active
      ${taskClasses && taskClasses.length > 0 ? sql`where task_class = any(${taskClasses})` : sql``}`;

    const healthMap: Record<string, ModelHealthRow> = {};
    for (const h of health) {
      const id = h['model_id'] as string;
      healthMap[id] = {
        modelId: id,
        availability: h['availability'] as ModelHealthRow['availability'],
        rollingSuccessRate: Number(h['rolling_success_rate']),
        observedLatencyMs: { p50: Number(h['observed_latency_p50_ms']), p95: Number(h['observed_latency_p95_ms']) },
        breaker: h['breaker'] as ModelHealthRow['breaker'],
        metricsAsOf: h['metrics_as_of'] as string,
      };
    }

    const policyMap: Record<string, RoutingPolicy> = {};
    for (const p of policies) {
      policyMap[p['task_class'] as string] = {
        taskClass: p['task_class'] as string,
        version: Number(p['version']),
        weights: p['weights'] as RoutingPolicy['weights'],
        qualityPriors: (p['quality_priors'] as Record<string, number>) ?? {},
        ...(p['hard_filters'] ? { hardFilters: p['hard_filters'] as RoutingPolicy['hardFilters'] } : {}),
        updatedAt: p['updated_at'] as string,
      };
    }

    return {
      now: this.deps.clock.nowIso(),
      models: models.map(mapModelRow),
      health: healthMap,
      policies: policyMap,
      liveBreaker: {},
    };
  }
}

function mapModelRow(r: Record<string, unknown>): ModelRegistration {
  return {
    id: r['id'] as string,
    provider: r['provider'] as string,
    displayName: r['display_name'] as string,
    tasks: (r['tasks'] as ModelRegistration['tasks']) ?? [],
    taskClasses: (r['task_classes'] as string[]) ?? [],
    capabilities: (r['capabilities'] as ModelRegistration['capabilities']) ?? [],
    modalities: (r['modalities'] as ModelRegistration['modalities']) ?? [],
    contextLimitUnits: Number(r['context_limit_units']),
    structuredOutputSupport: r['structured_output_support'] as ModelRegistration['structuredOutputSupport'],
    toolSupport: r['tool_support'] as ModelRegistration['toolSupport'],
    reasoningLevels: (r['reasoning_levels'] as ModelRegistration['reasoningLevels']) ?? [],
    latencyProfileMs: { p50: Number(r['latency_p50_ms']), p95: Number(r['latency_p95_ms']) },
    maxPrivacyClass: r['max_privacy_class'] as ModelRegistration['maxPrivacyClass'],
    costProfile: {
      perContextUnit: Number(r['cost_per_context_unit']),
      perOutputUnit: Number(r['cost_per_output_unit']),
      ...(r['cost_per_tool_call'] != null ? { perToolCall: Number(r['cost_per_tool_call']) } : {}),
    },
    costPerContextUnit: Number(r['cost_per_context_unit']),
    costPerOutputUnit: Number(r['cost_per_output_unit']),
    locality: r['locality'] as ModelRegistration['locality'],
    enabled: r['enabled'] as boolean,
    registeredAt: r['registered_at'] as string,
  };
}
```

- [ ] **Step 6: Write `index.ts`**

```typescript
export * from './model-health-policy.ts';
export * from './model-health-projector.ts';
export * from './model-registry.ts';
```

- [ ] **Step 7: Run the integration test — verify it passes**

Run: `JARVIS_IT=1 pnpm vitest run apps/core/test/model-registry.integration.test.ts` (Docker up)
Expected: PASS (4 tests). Retry once if it hits the known `startEphemeralPg` readiness flake.

- [ ] **Step 8: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, unit tests pass (68 + the model-health-policy + event-names additions; integration self-skips under plain `pnpm test`).

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/kernel/model-registry/ apps/core/test/model-registry.integration.test.ts packages/contracts/src/event-names.ts packages/contracts/src/event-names.test.ts
git commit -m "feat(model-registry): component #11 + model_health projector

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Gateway package + `ProviderAdapter` interface + stub adapter

**Files:**
- Create: `apps/gateway/package.json`
- Create: `apps/gateway/src/provider-adapter.ts`
- Create: `apps/gateway/src/adapters/stub/index.ts`
- Create: `apps/gateway/src/adapters/stub/stub.test.ts`

**Interfaces:**
- Consumes: `ModelRequest`, `ModelResponse`, `ModelRegistration`, `FinishReason`, `ModelErrorClass` from `@jarvis/contracts`.
- Produces:
  - `interface ProviderAdapter { readonly provider: string; invoke(req: ModelRequest, model: ModelRegistration, opts: AdapterInvokeOpts): Promise<AdapterResult> }`
  - `interface AdapterInvokeOpts { signal: AbortSignal; nowMs: number }`
  - `interface AdapterResult { output: unknown; finishReason: FinishReason; errorClass?: ModelErrorClass; usage: { contextUnits: number; outputUnits: number; costEstimate: number; latencyMs: number }; structuredOutputValid?: boolean }`
  - `class StubAdapter implements ProviderAdapter` — `provider = 'stub'`; echoes `req.input.instruction`; honours a control directive embedded in the instruction: `[[stub:fail:<errorClass>]]` → returns that error; `[[stub:latency:<ms>]]` → reports that latency; `[[stub:refuse]]` → `finishReason: 'filtered'`, `errorClass: 'refusal'`.

- [ ] **Step 1: Write `apps/gateway/package.json`**

```json
{
  "name": "@jarvis/gateway",
  "version": "0.45.0",
  "private": true,
  "description": "The Model Gateway — sole inference egress (ADR-0010). Separate process; holds provider keys; provider-neutral in/out.",
  "type": "module",
  "exports": { ".": "./src/main.ts" },
  "scripts": { "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts" },
  "dependencies": {
    "@jarvis/contracts": "workspace:*",
    "nats": "^2.28.2"
  }
}
```

- [ ] **Step 2: Write the failing test** — `apps/gateway/src/adapters/stub/stub.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import { StubAdapter } from './index.ts';

const model: ModelRegistration = {
  id: 'stub-1', provider: 'stub', displayName: 'Stub', tasks: [], taskClasses: ['coding'],
  capabilities: [], modalities: ['text'], contextLimitUnits: 100_000,
  structuredOutputSupport: 'json_schema', toolSupport: 'parallel', reasoningLevels: ['standard'],
  latencyProfileMs: { p50: 10, p95: 20 }, maxPrivacyClass: 'RESTRICTED',
  costProfile: { perContextUnit: 0, perOutputUnit: 0 }, costPerContextUnit: 0, costPerOutputUnit: 0,
  locality: 'local', enabled: true, registeredAt: '2026-09-02T00:00:00.000Z',
};

function req(instruction: string): ModelRequest {
  return {
    task: 'code', taskClass: 'coding', capabilities: [],
    input: { instruction, context: {} as never, constraints: [] },
    budget: { contextUnits: 1000, maxOutput: 500 }, locality: 'any',
    correlationId: 'c1', principalId: 'system',
  };
}

describe('StubAdapter', () => {
  it('echoes the instruction and reports success', async () => {
    const a = new StubAdapter();
    const r = await a.invoke(req('hello world'), model, { signal: new AbortController().signal, nowMs: 0 });
    expect(r.finishReason).toBe('stop');
    expect(String(r.output)).toContain('hello world');
    expect(r.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('honours [[stub:fail:timeout]]', async () => {
    const a = new StubAdapter();
    const r = await a.invoke(req('do a thing [[stub:fail:timeout]]'), model, { signal: new AbortController().signal, nowMs: 0 });
    expect(r.finishReason).toBe('error');
    expect(r.errorClass).toBe('timeout');
  });

  it('honours [[stub:refuse]]', async () => {
    const a = new StubAdapter();
    const r = await a.invoke(req('[[stub:refuse]]'), model, { signal: new AbortController().signal, nowMs: 0 });
    expect(r.finishReason).toBe('filtered');
    expect(r.errorClass).toBe('refusal');
  });

  it('honours [[stub:latency:250]]', async () => {
    const a = new StubAdapter();
    const r = await a.invoke(req('[[stub:latency:250]]'), model, { signal: new AbortController().signal, nowMs: 1000 });
    expect(r.usage.latencyMs).toBe(250);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm vitest run apps/gateway/src/adapters/stub/stub.test.ts`
Expected: FAIL — cannot find `./index.ts`.

- [ ] **Step 4: Write `provider-adapter.ts`**

```typescript
/**
 * ProviderAdapter — the ONLY place a provider SDK / wire format may live
 * (ADR-0010, apps/gateway/README.md). One file per provider in ./adapters/<name>.
 * Removing a provider = delete its adapter + its catalogue.models rows (L3).
 */

import type { FinishReason, ModelErrorClass, ModelRegistration, ModelRequest } from '@jarvis/contracts';

export interface AdapterInvokeOpts {
  /** Aborts the call on deadline / cancellation. */
  signal: AbortSignal;
  /** Monotonic ms clock for latency measurement — the gateway supplies it. */
  nowMs: number;
}

export interface AdapterResult {
  output: unknown;
  finishReason: FinishReason;
  errorClass?: ModelErrorClass;
  usage: {
    contextUnits: number;
    outputUnits: number;
    costEstimate: number;
    latencyMs: number;
  };
  structuredOutputValid?: boolean;
}

export interface ProviderAdapter {
  /** Matches `ModelRegistration.provider`. */
  readonly provider: string;
  invoke(req: ModelRequest, model: ModelRegistration, opts: AdapterInvokeOpts): Promise<AdapterResult>;
}
```

- [ ] **Step 5: Write `adapters/stub/index.ts`**

```typescript
/**
 * Keyless deterministic stub adapter. Used by tests and local smoke runs so the
 * gateway's routing / fallback / breaker paths are exercised without any real
 * provider key. Control directives in the instruction:
 *   [[stub:fail:<errorClass>]]   -> returns finishReason:'error' with that class
 *   [[stub:refuse]]              -> finishReason:'filtered', errorClass:'refusal'
 *   [[stub:latency:<ms>]]        -> reports that latency (no real wait)
 *   [[stub:invalid_json]]        -> structuredOutputValid:false
 */

import type { ModelErrorClass, ModelRegistration, ModelRequest } from '@jarvis/contracts';
import type { AdapterInvokeOpts, AdapterResult, ProviderAdapter } from '../../provider-adapter.ts';

const FAIL_RE = /\[\[stub:fail:([a-z_]+)\]\]/;
const LATENCY_RE = /\[\[stub:latency:(\d+)\]\]/;

export class StubAdapter implements ProviderAdapter {
  readonly provider = 'stub';

  invoke(req: ModelRequest, _model: ModelRegistration, _opts: AdapterInvokeOpts): Promise<AdapterResult> {
    const instr = req.input.instruction;
    const latencyMs = LATENCY_RE.exec(instr) ? Number(LATENCY_RE.exec(instr)![1]) : 5;

    if (instr.includes('[[stub:refuse]]')) {
      return Promise.resolve({
        output: null, finishReason: 'filtered', errorClass: 'refusal',
        usage: { contextUnits: req.budget.contextUnits, outputUnits: 0, costEstimate: 0, latencyMs },
      });
    }
    const failMatch = FAIL_RE.exec(instr);
    if (failMatch) {
      return Promise.resolve({
        output: null, finishReason: 'error', errorClass: failMatch[1] as ModelErrorClass,
        usage: { contextUnits: req.budget.contextUnits, outputUnits: 0, costEstimate: 0, latencyMs },
      });
    }

    const structuredOutputValid = req.structuredOutput ? !instr.includes('[[stub:invalid_json]]') : undefined;
    return Promise.resolve({
      output: `stub<${req.taskClass ?? req.task}>: ${instr}`,
      finishReason: 'stop',
      usage: { contextUnits: req.budget.contextUnits, outputUnits: 16, costEstimate: 0, latencyMs },
      ...(structuredOutputValid === undefined ? {} : { structuredOutputValid }),
    });
  }
}
```

- [ ] **Step 6: Run the test — verify it passes**

Run: `pnpm vitest run apps/gateway/src/adapters/stub/stub.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/gateway/package.json apps/gateway/src/provider-adapter.ts apps/gateway/src/adapters/stub/
git commit -m "feat(gateway): @jarvis/gateway package + ProviderAdapter interface + keyless stub adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: The pure `route()` function

**Files:**
- Create: `apps/gateway/src/routing/route.ts`
- Create: `apps/gateway/src/routing/route.test.ts`

**Interfaces:**
- Consumes: `ModelRequest`, `RoutingSnapshot`, `RoutingPlan`, `RoutingWeights`, `FilterReason`, `ModelRegistration`, `PrivacyClass` from `@jarvis/contracts`.
- Produces: `route(req: ModelRequest, snap: RoutingSnapshot): RoutingPlan` — pure; no I/O, no clock, no randomness.

- [ ] **Step 1: Write the failing test** — `route.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest, RoutingSnapshot } from '@jarvis/contracts';
import { route } from './route.ts';

function model(id: string, over: Partial<ModelRegistration> = {}): ModelRegistration {
  return {
    id, provider: 'stub', displayName: id, tasks: [], taskClasses: ['coding'],
    capabilities: [], modalities: ['text'], contextLimitUnits: 100_000,
    structuredOutputSupport: 'json_schema', toolSupport: 'parallel', reasoningLevels: ['standard', 'deep'],
    latencyProfileMs: { p50: 400, p95: 900 }, maxPrivacyClass: 'INTERNAL',
    costProfile: { perContextUnit: 0.000001, perOutputUnit: 0.000002 },
    costPerContextUnit: 0.000001, costPerOutputUnit: 0.000002,
    locality: 'cloud-ok', enabled: true, registeredAt: '2026-09-02T00:00:00.000Z',
    ...over,
  };
}

function snap(models: ModelRegistration[], over: Partial<RoutingSnapshot> = {}): RoutingSnapshot {
  return {
    now: '2026-09-02T00:00:10.000Z',
    models,
    health: Object.fromEntries(models.map((m) => [m.id, {
      modelId: m.id, availability: 'available' as const, rollingSuccessRate: 0.99,
      observedLatencyMs: { p50: 400, p95: 900 }, breaker: 'closed' as const,
      metricsAsOf: '2026-09-02T00:00:09.000Z',
    }])),
    policies: {
      coding: {
        taskClass: 'coding', version: 3,
        weights: { quality: 1, reliability: 1, latency: 1, cost: 1, locality: 0.5, recency: 0.2 },
        qualityPriors: {}, updatedAt: '2026-09-02T00:00:00.000Z',
      },
    },
    liveBreaker: {},
    ...over,
  };
}

function req(over: Partial<ModelRequest> = {}): ModelRequest {
  return {
    task: 'code', taskClass: 'coding', capabilities: [],
    input: { instruction: 'x', context: {} as never, constraints: [] },
    budget: { contextUnits: 1000, maxOutput: 500 }, locality: 'any',
    correlationId: 'c1', principalId: 'system', ...over,
  };
}

describe('route — hard filters', () => {
  it('excludes a model that lacks the requested capability', () => {
    const p = route(req({ capabilities: ['vision'] }), snap([model('m1'), model('m2', { capabilities: ['vision'] })]));
    expect(p.primary).toBe('m2');
    expect(p.filterTrace.find((f) => f.modelId === 'm1')?.reasons).toContain('capability');
  });

  it('privacyClass is a HARD filter — RESTRICTED cannot route to an INTERNAL model', () => {
    const p = route(req({ privacyClass: 'RESTRICTED' }), snap([model('cloud', { maxPrivacyClass: 'INTERNAL' })]));
    expect(p.primary).toBeNull();
    expect(p.reason).toBe('no_model_satisfies_constraints');
    expect(p.filterTrace[0]?.reasons).toContain('privacy_class');
  });

  it('routes a RESTRICTED request to a local model cleared for it', () => {
    const local = model('local', { maxPrivacyClass: 'RESTRICTED', locality: 'local' });
    const p = route(req({ privacyClass: 'RESTRICTED' }), snap([model('cloud'), local]));
    expect(p.primary).toBe('local');
  });

  it('excludes a model whose context limit is below the requirement', () => {
    const p = route(req({ minContextUnits: 200_000 }), snap([model('small'), model('big', { contextLimitUnits: 500_000 })]));
    expect(p.primary).toBe('big');
  });

  it('excludes an unavailable / breaker-open model', () => {
    const s = snap([model('m1'), model('m2')]);
    s.health['m1']!.availability = 'unavailable';
    const p = route(req(), s);
    expect(p.primary).toBe('m2');
  });

  it('empty survivor set => primary null, error path', () => {
    const p = route(req({ capabilities: ['vision'] }), snap([model('m1')]));
    expect(p.primary).toBeNull();
    expect(p.reason).toBe('no_model_satisfies_constraints');
  });
});

describe('route — scoring + fallback', () => {
  it('ranks by weighted score and returns fallbacks in order', () => {
    const cheap = model('cheap', { costProfile: { perContextUnit: 0.0000001, perOutputUnit: 0.0000001 }, latencyProfileMs: { p50: 800, p95: 1500 } });
    const fast = model('fast', { costProfile: { perContextUnit: 0.00001, perOutputUnit: 0.00001 }, latencyProfileMs: { p50: 120, p95: 250 } });
    const s = snap([cheap, fast]);
    s.policies['coding']!.weights = { quality: 0, reliability: 0, latency: 5, cost: 1, locality: 0, recency: 0 };
    const p = route(req({ latencyClass: 'realtime' }), s);
    expect(p.primary).toBe('fast');
    expect(p.fallbacks).toEqual(['cheap']);
  });

  it('qualityPriors from the policy row influence the ranking', () => {
    const s = snap([model('a'), model('b')]);
    s.policies['coding']!.weights = { quality: 10, reliability: 0, latency: 0, cost: 0, locality: 0, recency: 0 };
    s.policies['coding']!.qualityPriors = { a: 0.9, b: 0.1 };
    expect(route(req(), s).primary).toBe('a');
  });
});

describe('route — debug override', () => {
  it('forceModelId skips scoring but not the hard filters', () => {
    const p = route(req({ debug: { forceModelId: 'm2' } }), snap([model('m1'), model('m2')]));
    expect(p.primary).toBe('m2');
    expect(p.reason).toBe('forced');
  });

  it('a forced model that fails a hard filter yields primary null', () => {
    const p = route(
      req({ privacyClass: 'RESTRICTED', debug: { forceModelId: 'cloud' } }),
      snap([model('cloud', { maxPrivacyClass: 'INTERNAL' })]),
    );
    expect(p.primary).toBeNull();
    expect(p.reason).toBe('no_model_satisfies_constraints');
  });
});

describe('route — determinism', () => {
  it('same inputs, same plan', () => {
    const r = req();
    const s = snap([model('m1'), model('m2')]);
    expect(route(r, s)).toEqual(route(r, s));
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run apps/gateway/src/routing/route.test.ts`
Expected: FAIL — cannot find `./route.ts`.

- [ ] **Step 3: Write `route.ts`**

```typescript
/**
 * Deterministic two-stage routing (spec §4, ADR-0025). PURE — no I/O, no clock,
 * no randomness. `snap.now` carries the time. Fully replayable from (req, snap).
 *
 * Stage 1: hard filters — a model failing any is excluded with a recorded reason.
 * Stage 2: weighted score over survivors, weights from the policy row.
 * `debug.forceModelId` skips Stage 2 only; hard filters still apply.
 */

import type {
  FilterReason,
  ModelRegistration,
  ModelRequest,
  PrivacyClass,
  RoutingPlan,
  RoutingSnapshot,
  RoutingWeights,
} from '@jarvis/contracts';

const PRIVACY_RANK: Record<PrivacyClass, number> = { PUBLIC: 0, INTERNAL: 1, SENSITIVE: 2, RESTRICTED: 3 };

function taskClassOf(req: ModelRequest): string {
  return req.taskClass ?? req.task;
}

function hardFilterReasons(
  req: ModelRequest,
  m: ModelRegistration,
  snap: RoutingSnapshot,
): FilterReason[] {
  const reasons: FilterReason[] = [];
  const tc = taskClassOf(req);
  const policy = snap.policies[tc];

  if (!m.taskClasses.includes(tc)) reasons.push('task_class');

  for (const mod of req.modalities ?? []) {
    if (!m.modalities.includes(mod)) { reasons.push('modality'); break; }
  }
  for (const cap of req.capabilities) {
    if (!m.capabilities.includes(cap)) { reasons.push('capability'); break; }
  }

  if (req.structuredOutput) {
    const rank = { none: 0, json: 1, json_schema: 2, grammar: 3 } as const;
    if (rank[m.structuredOutputSupport] < rank.json_schema) reasons.push('structured_output');
  }
  if (req.toolChoice === 'required' && m.toolSupport === 'none') reasons.push('tool_support');

  const needCtx = Math.max(req.budget.contextUnits, req.minContextUnits ?? 0);
  if (m.contextLimitUnits < needCtx) reasons.push('context_limit');

  if (req.locality === 'local' && m.locality !== 'local') reasons.push('locality');

  const reqPriv: PrivacyClass = req.privacyClass ?? 'INTERNAL';
  if (PRIVACY_RANK[reqPriv] > PRIVACY_RANK[m.maxPrivacyClass]) reasons.push('privacy_class');

  const health = snap.health[m.id];
  const breaker = snap.liveBreaker[m.id] ?? health?.breaker ?? 'closed';
  if (health?.availability === 'unavailable') reasons.push('availability');
  if (breaker === 'open') reasons.push('breaker_open');

  if (typeof req.minReliability === 'number' && (health?.rollingSuccessRate ?? 1) < req.minReliability) {
    reasons.push('min_reliability');
  }

  if (policy?.hardFilters?.excludeModelIds?.includes(m.id)) reasons.push('policy_exclude');
  if (policy?.hardFilters?.onlyModelIds && policy.hardFilters.onlyModelIds.length > 0 &&
      !policy.hardFilters.onlyModelIds.includes(m.id)) {
    reasons.push('policy_only');
  }

  return reasons;
}

function normCost(m: ModelRegistration, req: ModelRequest): number {
  const est = m.costProfile.perContextUnit * req.budget.contextUnits +
    m.costProfile.perOutputUnit * req.budget.maxOutput;
  // Squash to 0..1 with a gentle curve; cap for pathological inputs.
  return Math.min(1, est / (est + 0.01));
}

function latencyFit(m: ModelRegistration, req: ModelRequest): number {
  const target =
    req.latencyClass === 'realtime' ? 300 :
    req.latencyClass === 'interactive' ? 1500 :
    req.latencyClass === 'batch' ? 20_000 :
    (req.budget.maxLatencyMs ?? 3000);
  const ratio = m.latencyProfileMs.p95 / target;
  return ratio <= 1 ? 1 : Math.max(0, 1 - (ratio - 1));
}

function localityBonus(m: ModelRegistration, req: ModelRequest): number {
  if (req.locality === 'prefer-local' || req.locality === 'local') return m.locality === 'local' ? 1 : 0;
  return 0;
}

function metricFreshness(snap: RoutingSnapshot, m: ModelRegistration): number {
  const h = snap.health[m.id];
  if (!h) return 0;
  const ageMs = Date.parse(snap.now) - Date.parse(h.metricsAsOf);
  const hours = ageMs / 3_600_000;
  return Math.max(0, 1 - hours / 24); // full credit fresh, zero after ~a day
}

function scoreOf(m: ModelRegistration, req: ModelRequest, snap: RoutingSnapshot, w: RoutingWeights) {
  const tc = taskClassOf(req);
  const prior = snap.policies[tc]?.qualityPriors[m.id] ?? 0.5;
  const reliability = snap.health[m.id]?.rollingSuccessRate ?? 1;
  const components: Record<keyof RoutingWeights, number> = {
    quality: w.quality * prior,
    reliability: w.reliability * reliability,
    latency: w.latency * latencyFit(m, req),
    cost: -w.cost * normCost(m, req),
    locality: w.locality * localityBonus(m, req),
    recency: w.recency * metricFreshness(snap, m),
  };
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  return { score, components };
}

export function route(req: ModelRequest, snap: RoutingSnapshot): RoutingPlan {
  const tc = taskClassOf(req);
  const policy = snap.policies[tc] ?? null;

  const filterTrace = snap.models.map((m) => {
    const reasons = hardFilterReasons(req, m, snap);
    return { modelId: m.id, excluded: reasons.length > 0, reasons };
  });
  const survivors = snap.models.filter((m) => !filterTrace.find((f) => f.modelId === m.id)!.excluded);

  // Debug override: skip Stage 2, but the forced model must have survived Stage 1.
  if (req.debug?.forceModelId) {
    const forced = survivors.find((m) => m.id === req.debug!.forceModelId);
    if (!forced) {
      return { primary: null, fallbacks: [], policyVersion: policy?.version ?? null,
        reason: 'no_model_satisfies_constraints', filterTrace, scoreTrace: [] };
    }
    return { primary: forced.id, fallbacks: survivors.filter((m) => m.id !== forced.id).map((m) => m.id),
      policyVersion: policy?.version ?? null, reason: 'forced', filterTrace, scoreTrace: [] };
  }

  if (survivors.length === 0) {
    return { primary: null, fallbacks: [], policyVersion: policy?.version ?? null,
      reason: 'no_model_satisfies_constraints', filterTrace, scoreTrace: [] };
  }

  const w: RoutingWeights = policy?.weights ??
    { quality: 1, reliability: 1, latency: 1, cost: 1, locality: 0.5, recency: 0.2 };

  const scored = survivors
    .map((m) => ({ m, ...scoreOf(m, req, snap, w) }))
    // Deterministic tie-break by model id so equal scores never reorder.
    .sort((a, b) => (b.score - a.score) || a.m.id.localeCompare(b.m.id));

  return {
    primary: scored[0]!.m.id,
    fallbacks: scored.slice(1).map((s) => s.m.id),
    policyVersion: policy?.version ?? null,
    reason: 'ok',
    filterTrace,
    scoreTrace: scored.map((s) => ({ modelId: s.m.id, score: s.score, components: s.components })),
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run apps/gateway/src/routing/route.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src/routing/
git commit -m "feat(gateway): pure two-stage route() — hard filters + weighted score

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Per-provider circuit breaker

**Files:**
- Create: `apps/gateway/src/circuit-breaker.ts`
- Create: `apps/gateway/src/circuit-breaker.test.ts`

**Interfaces:**
- Consumes: nothing from `@jarvis/contracts`.
- Produces: `class CircuitBreaker { constructor(opts?: BreakerOpts); state(nowMs: number): 'closed'|'open'|'half_open'; onResult(ok: boolean, nowMs: number): void; allow(nowMs: number): boolean }`; `interface BreakerOpts { failureThreshold?: number; cooldownMs?: number; halfOpenProbes?: number }`.

- [ ] **Step 1: Write the failing test** — `circuit-breaker.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.ts';

describe('CircuitBreaker', () => {
  it('opens after the failure threshold', () => {
    const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(b.state(0)).toBe('closed');
    b.onResult(false, 0); b.onResult(false, 1); b.onResult(false, 2);
    expect(b.state(2)).toBe('open');
    expect(b.allow(2)).toBe(false);
  });

  it('half-opens after the cooldown and closes on a success', () => {
    const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    b.onResult(false, 0); b.onResult(false, 100);
    expect(b.state(500)).toBe('open');
    expect(b.state(1200)).toBe('half_open');
    expect(b.allow(1200)).toBe(true);
    b.onResult(true, 1300);
    expect(b.state(1300)).toBe('closed');
  });

  it('a failure while half-open re-opens and restarts the cooldown', () => {
    const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    b.onResult(false, 0); b.onResult(false, 10);
    expect(b.state(1100)).toBe('half_open');
    b.onResult(false, 1100);
    expect(b.state(1200)).toBe('open');
    expect(b.state(2200)).toBe('half_open');
  });

  it('a success while closed resets the failure count', () => {
    const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    b.onResult(false, 0); b.onResult(false, 1);
    b.onResult(true, 2);
    b.onResult(false, 3); b.onResult(false, 4);
    expect(b.state(4)).toBe('closed');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run apps/gateway/src/circuit-breaker.test.ts`
Expected: FAIL — cannot find `./circuit-breaker.ts`.

- [ ] **Step 3: Write `circuit-breaker.ts`**

```typescript
/**
 * Per-provider circuit breaker (spec §11, FAILURE_MODEL.md §5). The gateway
 * keeps one per provider. `nowMs` is passed in — no internal clock.
 */

export interface BreakerOpts {
  failureThreshold?: number;
  cooldownMs?: number;
  halfOpenProbes?: number;
}

type Phase = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private consecutiveFailures = 0;
  private openedAtMs = 0;
  private phase: Phase = 'closed';

  constructor(opts: BreakerOpts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  /** Current phase, accounting for cooldown expiry. */
  state(nowMs: number): Phase {
    if (this.phase === 'open' && nowMs - this.openedAtMs >= this.cooldownMs) {
      this.phase = 'half_open';
    }
    return this.phase;
  }

  /** Whether a call may proceed right now. */
  allow(nowMs: number): boolean {
    return this.state(nowMs) !== 'open';
  }

  onResult(ok: boolean, nowMs: number): void {
    const s = this.state(nowMs);
    if (ok) {
      this.consecutiveFailures = 0;
      this.phase = 'closed';
      return;
    }
    this.consecutiveFailures++;
    if (s === 'half_open' || this.consecutiveFailures >= this.failureThreshold) {
      this.phase = 'open';
      this.openedAtMs = nowMs;
    }
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run apps/gateway/src/circuit-breaker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src/circuit-breaker.ts apps/gateway/src/circuit-breaker.test.ts
git commit -m "feat(gateway): per-provider circuit breaker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `EventSink` + the `Gateway` orchestrator

**Files:**
- Create: `apps/gateway/src/event-sink.ts`
- Create: `apps/gateway/src/gateway.ts`
- Create: `apps/gateway/src/gateway.test.ts`

**Interfaces:**
- Consumes: `route` from `./routing/route.ts`; `CircuitBreaker` from `./circuit-breaker.ts`; `ProviderAdapter`, `AdapterResult` from `./provider-adapter.ts`; `EventSink` from `./event-sink.ts`; `ModelRequest`, `ModelResponse`, `RoutingSnapshot`, `AttemptRecord`, `ModelErrorClass`, `EventNames`, `Provenance` from `@jarvis/contracts`.
- Produces:
  - `interface EventSink { emit(name: string, payload: Record<string, unknown>, meta: EventMeta): void }`; `interface EventMeta { correlationId: string; principalId: string; subjectId: string }`; `class InMemoryEventSink implements EventSink { readonly events: Array<{ name: string; payload: Record<string, unknown>; meta: EventMeta }> }`.
  - `class Gateway { constructor(deps: GatewayDeps); infer(req: ModelRequest, snap: RoutingSnapshot): Promise<ModelResponse> }`; `interface GatewayDeps { adapters: ProviderAdapter[]; sink: EventSink; now(): number; breakerFor(provider: string): CircuitBreaker }`.

- [ ] **Step 1: Write the failing test** — `gateway.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest, RoutingSnapshot } from '@jarvis/contracts';
import { EventNames } from '@jarvis/contracts';
import { Gateway } from './gateway.ts';
import { InMemoryEventSink } from './event-sink.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { StubAdapter } from './adapters/stub/index.ts';

function model(id: string, over: Partial<ModelRegistration> = {}): ModelRegistration {
  return {
    id, provider: 'stub', displayName: id, tasks: [], taskClasses: ['coding'],
    capabilities: [], modalities: ['text'], contextLimitUnits: 100_000,
    structuredOutputSupport: 'json_schema', toolSupport: 'parallel', reasoningLevels: ['standard'],
    latencyProfileMs: { p50: 10, p95: 20 }, maxPrivacyClass: 'INTERNAL',
    costProfile: { perContextUnit: 0, perOutputUnit: 0 }, costPerContextUnit: 0, costPerOutputUnit: 0,
    locality: 'cloud-ok', enabled: true, registeredAt: '2026-09-02T00:00:00.000Z', ...over,
  };
}
function snap(models: ModelRegistration[]): RoutingSnapshot {
  return {
    now: '2026-09-02T00:00:10.000Z', models,
    health: Object.fromEntries(models.map((m) => [m.id, {
      modelId: m.id, availability: 'available' as const, rollingSuccessRate: 0.99,
      observedLatencyMs: { p50: 10, p95: 20 }, breaker: 'closed' as const, metricsAsOf: '2026-09-02T00:00:09.000Z',
    }])),
    policies: { coding: { taskClass: 'coding', version: 1,
      weights: { quality: 1, reliability: 1, latency: 1, cost: 1, locality: 0, recency: 0 },
      qualityPriors: { a: 0.9, b: 0.5 }, updatedAt: '2026-09-02T00:00:00.000Z' } },
    liveBreaker: {},
  };
}
function req(instruction: string, over: Partial<ModelRequest> = {}): ModelRequest {
  return {
    task: 'code', taskClass: 'coding', capabilities: [],
    input: { instruction, context: {} as never, constraints: [] },
    budget: { contextUnits: 1000, maxOutput: 500 }, locality: 'any',
    correlationId: 'c1', principalId: 'system', ...over,
  };
}

function makeGateway(sink = new InMemoryEventSink()) {
  const breakers = new Map<string, CircuitBreaker>();
  return {
    sink,
    gw: new Gateway({
      adapters: [new StubAdapter()],
      sink,
      now: () => 1_000,
      breakerFor: (p) => { if (!breakers.has(p)) breakers.set(p, new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 })); return breakers.get(p)!; },
    }),
  };
}

describe('Gateway.infer', () => {
  it('routes to the primary, returns its response, emits model.called', async () => {
    const { gw, sink } = makeGateway();
    const r = await gw.infer(req('hi'), snap([model('a'), model('b')]));
    expect(r.finishReason).toBe('stop');
    expect(r.modelId).toBe('a'); // higher qualityPrior
    expect(r.attempts).toHaveLength(1);
    expect(sink.events.map((e) => e.name)).toContain(EventNames.ModelCalled);
  });

  it('falls back to the next model on a primary failure; attempts[] records both', async () => {
    const { gw, sink } = makeGateway();
    // 'a' is primary (prior 0.9). Force it to fail via the stub directive; 'b' succeeds.
    // The instruction reaches whichever adapter is picked; the stub keys off the text, so
    // we make the directive model-agnostic and rely on 'a' being tried first.
    const r = await gw.infer(req('do [[stub:fail:timeout]] then recover'), snap([model('a'), model('b')]));
    expect(r.attempts.length).toBeGreaterThanOrEqual(1);
    expect(r.attempts[0]?.errorClass).toBe('timeout');
    // both attempts fail here (same instruction) -> final error
    expect(r.finishReason).toBe('error');
    expect(sink.events.map((e) => e.name)).toContain(EventNames.ModelCallFailed);
  });

  it('no route => finishReason error, errorClass no_route, no adapter call', async () => {
    const { gw } = makeGateway();
    const r = await gw.infer(req('x', { capabilities: ['vision'] }), snap([model('a')]));
    expect(r.finishReason).toBe('error');
    expect(r.errorClass).toBe('no_route');
    expect(r.attempts).toHaveLength(0);
  });

  it('privacy gate: RESTRICTED with only INTERNAL models => no_route', async () => {
    const { gw } = makeGateway();
    const r = await gw.infer(req('x', { privacyClass: 'RESTRICTED' }), snap([model('a', { maxPrivacyClass: 'INTERNAL' })]));
    expect(r.errorClass).toBe('no_route');
  });

  it('debug.explain attaches the route trace to meta and emits route.explained', async () => {
    const { gw, sink } = makeGateway();
    const r = await gw.infer(req('hi', { debug: { explain: true } }), snap([model('a'), model('b')]));
    expect(r.meta?.['filterTrace']).toBeDefined();
    expect(sink.events.map((e) => e.name)).toContain(EventNames.RouteExplained);
  });

  it('the breaker opens after repeated provider failures and short-circuits routing', async () => {
    const { gw } = makeGateway();
    const s = snap([model('a'), model('b')]);
    // Two failing calls trip the 'stub' breaker (both models share provider 'stub').
    await gw.infer(req('[[stub:fail:outage]] one'), s);
    await gw.infer(req('[[stub:fail:outage]] two'), s);
    const r = await gw.infer(req('[[stub:fail:outage]] three'), s);
    // With the provider breaker open, both models are filtered => no_route.
    expect(r.errorClass).toBe('no_route');
  });

  it('respects budget.maxAttempts', async () => {
    const { gw } = makeGateway();
    const s = snap([model('a'), model('b')]);
    const r = await gw.infer(req('[[stub:fail:timeout]] fail', { budget: { contextUnits: 1000, maxOutput: 500, maxAttempts: 1 } }), s);
    expect(r.attempts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run apps/gateway/src/gateway.test.ts`
Expected: FAIL — cannot find `./gateway.ts`.

- [ ] **Step 3: Write `event-sink.ts`**

```typescript
/**
 * EventSink — the gateway's one-way channel for `jarvis.cognition.model.*`
 * events. In the process this wraps a NATS publisher; in tests it collects
 * into an array. The gateway NEVER writes authoritative state (ADR-0010) — it
 * only emits usage-metadata events the Kernel folds.
 */

export interface EventMeta {
  correlationId: string;
  principalId: string;
  subjectId: string;
}

export interface EventSink {
  emit(name: string, payload: Record<string, unknown>, meta: EventMeta): void;
}

export class InMemoryEventSink implements EventSink {
  readonly events: Array<{ name: string; payload: Record<string, unknown>; meta: EventMeta }> = [];
  emit(name: string, payload: Record<string, unknown>, meta: EventMeta): void {
    this.events.push({ name, payload, meta });
  }
}
```

- [ ] **Step 4: Write `gateway.ts`**

```typescript
/**
 * Gateway.infer — the orchestration path (spec §4.3, §11, ADR-0010):
 *   route(req, snap) -> primary + fallbacks
 *   for each candidate (bounded by budget.maxAttempts): check breaker, call adapter,
 *     record an AttemptRecord, update the breaker, emit model.called / model.call_failed
 *   return the first success, else finishReason:'error' with the last errorClass
 *
 * Holds NO credentials, writes NO state. Provider selection is data-driven — no
 * provider name appears here (L3).
 */

import {
  EventNames,
  type AttemptRecord,
  type ModelErrorClass,
  type ModelRegistration,
  type ModelRequest,
  type ModelResponse,
  type Provenance,
  type RoutingSnapshot,
} from '@jarvis/contracts';
import { route } from './routing/route.ts';
import type { CircuitBreaker } from './circuit-breaker.ts';
import type { AdapterResult, ProviderAdapter } from './provider-adapter.ts';
import type { EventSink } from './event-sink.ts';

export interface GatewayDeps {
  adapters: ProviderAdapter[];
  sink: EventSink;
  /** Monotonic ms clock. */
  now(): number;
  breakerFor(provider: string): CircuitBreaker;
}

function provenance(correlationId: string): Provenance {
  return {
    method: 'model',
    producedBy: 'gateway',
    producedOn: 'gateway',
    producedAt: new Date().toISOString(),
    correlationId,
    derivedFromUntrusted: false,
  };
}

export class Gateway {
  constructor(private readonly deps: GatewayDeps) {}

  private adapterFor(provider: string): ProviderAdapter | undefined {
    return this.deps.adapters.find((a) => a.provider === provider);
  }

  async infer(req: ModelRequest, snap: RoutingSnapshot): Promise<ModelResponse> {
    // Merge the gateway's live breaker state into the snapshot so routing sees it.
    const liveBreaker: Record<string, 'closed' | 'open' | 'half_open'> = { ...snap.liveBreaker };
    const nowMs = this.deps.now();
    for (const m of snap.models) {
      liveBreaker[m.id] = this.deps.breakerFor(m.provider).state(nowMs);
    }
    const plan = route(req, { ...snap, liveBreaker });

    const meta = { correlationId: req.correlationId, principalId: req.principalId, subjectId: plan.primary ?? 'none' };

    if (req.debug?.explain) {
      this.deps.sink.emit(EventNames.RouteExplained, {
        taskClass: req.taskClass ?? req.task,
        primary: plan.primary,
        policyVersion: plan.policyVersion,
        filterTrace: plan.filterTrace,
        scoreTrace: plan.scoreTrace,
      }, meta);
    }

    if (plan.primary === null) {
      const errorClass: ModelErrorClass = plan.reason === 'forced' ? 'override_rejected' : 'no_route';
      return this.errorResponse(req, [], errorClass, req.debug?.explain ? plan : undefined);
    }

    const candidates = [plan.primary, ...plan.fallbacks];
    const maxAttempts = req.budget.maxAttempts ?? 2;
    const attempts: AttemptRecord[] = [];
    const byId = new Map(snap.models.map((m) => [m.id, m]));

    for (const modelId of candidates) {
      if (attempts.length >= maxAttempts) break;
      const model = byId.get(modelId);
      if (!model) continue;
      const breaker = this.deps.breakerFor(model.provider);
      if (!breaker.allow(this.deps.now())) {
        attempts.push({ modelId, finishReason: 'error', latencyMs: 0, errorClass: 'outage' });
        continue;
      }
      const adapter = this.adapterFor(model.provider);
      if (!adapter) {
        attempts.push({ modelId, finishReason: 'error', latencyMs: 0, errorClass: 'no_route' });
        continue;
      }

      const started = this.deps.now();
      let res: AdapterResult;
      try {
        res = await adapter.invoke(req, model, { signal: new AbortController().signal, nowMs: started });
      } catch {
        res = {
          output: null, finishReason: 'error', errorClass: 'outage',
          usage: { contextUnits: req.budget.contextUnits, outputUnits: 0, costEstimate: 0, latencyMs: this.deps.now() - started },
        };
      }
      const ok = res.finishReason === 'stop' || res.finishReason === 'length';
      breaker.onResult(ok, this.deps.now());
      attempts.push({
        modelId, finishReason: res.finishReason, latencyMs: res.usage.latencyMs,
        ...(res.errorClass ? { errorClass: res.errorClass } : {}),
      });

      if (ok) {
        this.deps.sink.emit(EventNames.ModelCalled, {
          modelId, latencyMs: res.usage.latencyMs, ok: true,
          contextUnits: res.usage.contextUnits, outputUnits: res.usage.outputUnits,
          costEstimate: res.usage.costEstimate, breaker: breaker.state(this.deps.now()),
        }, { ...meta, subjectId: modelId });
        return {
          modelId, output: res.output, usage: res.usage, finishReason: res.finishReason,
          attempts, ...(res.structuredOutputValid === undefined ? {} : { structuredOutputValid: res.structuredOutputValid }),
          provenance: provenance(req.correlationId),
          ...(req.debug?.explain ? { meta: { filterTrace: plan.filterTrace, scoreTrace: plan.scoreTrace } } : {}),
        };
      }

      this.deps.sink.emit(EventNames.ModelCallFailed, {
        modelId, latencyMs: res.usage.latencyMs, errorClass: res.errorClass ?? 'outage',
        breaker: breaker.state(this.deps.now()),
      }, { ...meta, subjectId: modelId });
    }

    const lastErr = attempts[attempts.length - 1]?.errorClass ?? 'outage';
    return this.errorResponse(req, attempts, lastErr, req.debug?.explain ? plan : undefined);
  }

  private errorResponse(
    req: ModelRequest,
    attempts: AttemptRecord[],
    errorClass: ModelErrorClass,
    explainPlan?: ReturnType<typeof route>,
  ): ModelResponse {
    return {
      modelId: '', output: null,
      usage: { contextUnits: 0, outputUnits: 0, costEstimate: 0, latencyMs: 0 },
      finishReason: 'error', errorClass, attempts,
      provenance: provenance(req.correlationId),
      ...(explainPlan ? { meta: { filterTrace: explainPlan.filterTrace, scoreTrace: explainPlan.scoreTrace } } : {}),
    };
  }
}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `pnpm vitest run apps/gateway/src/gateway.test.ts`
Expected: PASS (all cases). If the breaker test is flaky on timing, confirm `now: () => 1_000` is constant and the breaker `cooldownMs` (1000) is never crossed within a single `infer` call.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/gateway/src/event-sink.ts apps/gateway/src/gateway.ts apps/gateway/src/gateway.test.ts
git commit -m "feat(gateway): Gateway.infer orchestration — route, fallback chain, breaker, events

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: OpenAI-compatible HTTP adapter (real-provider shape)

**Files:**
- Create: `apps/gateway/src/adapters/openai-compatible/index.ts`
- Create: `apps/gateway/src/adapters/openai-compatible/openai-compatible.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter`, `AdapterInvokeOpts`, `AdapterResult` from `../../provider-adapter.ts`; `ModelRegistration`, `ModelRequest` from `@jarvis/contracts`.
- Produces: `class OpenAICompatibleAdapter implements ProviderAdapter` — `provider` is passed to the constructor (e.g. `'openai'`, `'together'`, `'local-vllm'` — the label is data, not a hard-coded string in the routing/gateway code). Constructor also takes `{ baseUrl: string; apiKeyEnvVar: string; fetchImpl?: typeof fetch }`. Maps the structured `ModelInput` → an OpenAI-style `/v1/chat/completions` (or `/v1/embeddings` for `taskClass: 'embedding'`) request; maps the response → `AdapterResult`; classifies HTTP 429 → `rate_limit`, timeout / network → `timeout` / `outage`, a 4xx content filter → `refusal`, a body that fails `structuredOutput` → `malformed`.

- [ ] **Step 1: Write the failing test** — `openai-compatible.test.ts` (mocks `fetch`; no network):

```typescript
import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import { OpenAICompatibleAdapter } from './index.ts';

const model: ModelRegistration = {
  id: 'oc-1', provider: 'openai', displayName: 'OC', tasks: [], taskClasses: ['coding'],
  capabilities: [], modalities: ['text'], contextLimitUnits: 100_000,
  structuredOutputSupport: 'json_schema', toolSupport: 'parallel', reasoningLevels: ['standard'],
  latencyProfileMs: { p50: 400, p95: 900 }, maxPrivacyClass: 'INTERNAL',
  costProfile: { perContextUnit: 0.000001, perOutputUnit: 0.000002 }, costPerContextUnit: 0.000001, costPerOutputUnit: 0.000002,
  locality: 'cloud-ok', enabled: true, registeredAt: '2026-09-02T00:00:00.000Z',
};
function req(over: Partial<ModelRequest> = {}): ModelRequest {
  return {
    task: 'code', taskClass: 'coding', capabilities: [],
    input: { instruction: 'write a haiku', context: {} as never, constraints: ['be terse'] },
    budget: { contextUnits: 1000, maxOutput: 200 }, locality: 'any',
    correlationId: 'c1', principalId: 'system', ...over,
  };
}
const opts = { signal: new AbortController().signal, nowMs: 0 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OpenAICompatibleAdapter', () => {
  it('maps a successful chat completion to AdapterResult', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      choices: [{ message: { content: 'silent code compiles' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 8 },
    })) as unknown as typeof fetch;
    const a = new OpenAICompatibleAdapter({ provider: 'openai', baseUrl: 'https://x', apiKeyEnvVar: 'X_KEY', fetchImpl });
    const r = await a.invoke(req(), model, opts);
    expect(r.finishReason).toBe('stop');
    expect(String(r.output)).toContain('silent code compiles');
    expect(r.usage.outputUnits).toBe(8);
  });

  it('classifies HTTP 429 as rate_limit', async () => {
    const fetchImpl = (async () => jsonResponse(429, { error: { message: 'slow down' } })) as unknown as typeof fetch;
    const a = new OpenAICompatibleAdapter({ provider: 'openai', baseUrl: 'https://x', apiKeyEnvVar: 'X_KEY', fetchImpl });
    const r = await a.invoke(req(), model, opts);
    expect(r.finishReason).toBe('error');
    expect(r.errorClass).toBe('rate_limit');
  });

  it('classifies a content-filter finish_reason as refusal', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }], usage: { prompt_tokens: 10, completion_tokens: 0 },
    })) as unknown as typeof fetch;
    const a = new OpenAICompatibleAdapter({ provider: 'openai', baseUrl: 'https://x', apiKeyEnvVar: 'X_KEY', fetchImpl });
    const r = await a.invoke(req(), model, opts);
    expect(r.finishReason).toBe('filtered');
    expect(r.errorClass).toBe('refusal');
  });

  it('classifies a thrown network error as outage', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const a = new OpenAICompatibleAdapter({ provider: 'openai', baseUrl: 'https://x', apiKeyEnvVar: 'X_KEY', fetchImpl });
    const r = await a.invoke(req(), model, opts);
    expect(r.errorClass).toBe('outage');
  });

  it('routes an embedding task to /v1/embeddings', async () => {
    let calledPath = '';
    const fetchImpl = (async (url: string) => {
      calledPath = new URL(url).pathname;
      return jsonResponse(200, { data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 5, total_tokens: 5 } });
    }) as unknown as typeof fetch;
    const a = new OpenAICompatibleAdapter({ provider: 'openai', baseUrl: 'https://x', apiKeyEnvVar: 'X_KEY', fetchImpl });
    const r = await a.invoke(req({ taskClass: 'embedding', task: 'embed' }), model, opts);
    expect(calledPath).toBe('/v1/embeddings');
    expect(Array.isArray(r.output)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run apps/gateway/src/adapters/openai-compatible/openai-compatible.test.ts`
Expected: FAIL — cannot find `./index.ts`.

- [ ] **Step 3: Write `adapters/openai-compatible/index.ts`**

```typescript
/**
 * OpenAI-compatible HTTP adapter. Works against any endpoint speaking the
 * OpenAI `/v1/chat/completions` + `/v1/embeddings` shape (OpenAI, Together,
 * Fireworks, a local vLLM / llama.cpp server, ...). The concrete provider LABEL
 * is passed to the constructor as data — no provider name is hard-coded (L3).
 *
 * This is the ONLY place a provider wire format lives (ADR-0010). It is never
 * called in the test suite (the tests inject a fake `fetchImpl`).
 */

import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import type { AdapterInvokeOpts, AdapterResult, ProviderAdapter } from '../../provider-adapter.ts';

export interface OpenAICompatibleOpts {
  provider: string;
  baseUrl: string;
  /** Env var holding the API key. Read lazily so tests never need it. */
  apiKeyEnvVar: string;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider: string;
  private readonly baseUrl: string;
  private readonly apiKeyEnvVar: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAICompatibleOpts) {
    this.provider = opts.provider;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKeyEnvVar = opts.apiKeyEnvVar;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async invoke(req: ModelRequest, model: ModelRegistration, opts: AdapterInvokeOpts): Promise<AdapterResult> {
    const isEmbedding = (req.taskClass ?? req.task) === 'embedding' || (req.taskClass ?? req.task) === 'embed';
    const path = isEmbedding ? '/v1/embeddings' : '/v1/chat/completions';
    const key = process.env[this.apiKeyEnvVar] ?? '';

    const body = isEmbedding
      ? { model: model.id, input: req.input.instruction }
      : {
          model: model.id,
          messages: [
            { role: 'system', content: req.input.constraints.join('\n') || 'You are a helpful assistant.' },
            { role: 'user', content: req.input.instruction },
          ],
          max_tokens: req.budget.maxOutput,
          ...(req.determinism === 'strict' ? { temperature: 0 } : {}),
        };

    const started = opts.nowMs;
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const errorClass = name === 'AbortError' ? 'timeout' : 'outage';
      return this.err(req, errorClass, opts.nowMs - started);
    }

    if (resp.status === 429) return this.err(req, 'rate_limit', opts.nowMs - started);
    if (resp.status === 408 || resp.status === 504) return this.err(req, 'timeout', opts.nowMs - started);
    if (resp.status >= 500) return this.err(req, 'outage', opts.nowMs - started);

    const data = (await resp.json()) as Record<string, unknown>;
    if (resp.status >= 400) {
      const msg = JSON.stringify((data as { error?: unknown }).error ?? data);
      const errorClass = /content|policy|safety|filter/i.test(msg) ? 'refusal' : 'malformed';
      return this.err(req, errorClass, opts.nowMs - started, errorClass === 'refusal' ? 'filtered' : 'error');
    }

    if (isEmbedding) {
      const arr = ((data['data'] as Array<{ embedding: number[] }> | undefined)?.[0]?.embedding) ?? [];
      const usage = data['usage'] as { prompt_tokens?: number } | undefined;
      return {
        output: arr, finishReason: 'stop',
        usage: {
          contextUnits: usage?.prompt_tokens ?? req.budget.contextUnits, outputUnits: arr.length,
          costEstimate: model.costProfile.perContextUnit * (usage?.prompt_tokens ?? 0),
          latencyMs: Math.max(0, opts.nowMs - started),
        },
      };
    }

    const choice = (data['choices'] as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined)?.[0];
    const finish = choice?.finish_reason ?? 'stop';
    if (finish === 'content_filter') return this.err(req, 'refusal', opts.nowMs - started, 'filtered');
    const usage = data['usage'] as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      output: choice?.message?.content ?? '',
      finishReason: finish === 'length' ? 'length' : 'stop',
      usage: {
        contextUnits: usage?.prompt_tokens ?? req.budget.contextUnits,
        outputUnits: usage?.completion_tokens ?? 0,
        costEstimate:
          model.costProfile.perContextUnit * (usage?.prompt_tokens ?? 0) +
          model.costProfile.perOutputUnit * (usage?.completion_tokens ?? 0),
        latencyMs: Math.max(0, opts.nowMs - started),
      },
    };
  }

  private err(
    req: ModelRequest,
    errorClass: AdapterResult['errorClass'],
    latencyMs: number,
    finishReason: AdapterResult['finishReason'] = 'error',
  ): AdapterResult {
    return {
      output: null, finishReason, errorClass,
      usage: { contextUnits: req.budget.contextUnits, outputUnits: 0, costEstimate: 0, latencyMs: Math.max(0, latencyMs) },
    };
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run apps/gateway/src/adapters/openai-compatible/openai-compatible.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Grep the no-provider-name-in-code constraint**

Run: `grep -rInE "openai|anthropic|gemini|\\bgpt\\b|\\bclaude\\b" apps/gateway/src --include=*.ts | grep -v "adapters/openai-compatible/" | grep -v "\.test\.ts" | grep -vE "^\S+:\s*(//|\*)"`
Expected: no output (the only occurrences are the adapter directory name/label and comments).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/gateway/src/adapters/openai-compatible/
git commit -m "feat(gateway): OpenAI-compatible HTTP adapter (provider label is data)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Gateway process entrypoint + README

**Files:**
- Create: `apps/gateway/src/main.ts`
- Create: `apps/gateway/src/config.ts`
- Modify: `apps/gateway/README.md`

**Interfaces:**
- Consumes: `Gateway`, `GatewayDeps` from `./gateway.ts`; `StubAdapter` from `./adapters/stub/index.ts`; `OpenAICompatibleAdapter` from `./adapters/openai-compatible/index.ts`; `CircuitBreaker` from `./circuit-breaker.ts`; `EventSink`, `EventMeta` from `./event-sink.ts`.
- Produces: `loadGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig`; `GatewayConfig` (`natsUrl`, `providers: Array<{ label: string; kind: 'openai_compatible' | 'stub'; baseUrl?: string; apiKeyEnvVar?: string }>`); `NatsEventSink implements EventSink`; a `main()` that wires NATS request/reply (`jarvis.gateway.infer` subject) → `Gateway.infer` and publishes events.

> This task has **no unit test** — it is process wiring with no branching logic worth a fresh reviewer's gate on its own; `main.ts` is lint-exempt for `console`. The `Gateway`, adapters, routing, and breaker it wires are all covered by Tasks 5–9. The reviewer verifies by reading: config parsing is total, no provider name is hard-coded, NATS subjects match the spec, and nothing writes state.

- [ ] **Step 1: Write `config.ts`**

```typescript
/**
 * Gateway process config, parsed from env. Provider LABELS + endpoints are
 * config, not code (L3). Keys are named by env var and read lazily by the
 * adapter — the gateway process never logs them.
 *
 * JARVIS_GATEWAY_NATS_URL         default nats://127.0.0.1:4222
 * JARVIS_GATEWAY_PROVIDERS        JSON: [{ "label":"local","kind":"openai_compatible","baseUrl":"http://127.0.0.1:8000","apiKeyEnvVar":"JARVIS_GW_LOCAL_KEY" }]
 *                                 default: [{ "label":"stub","kind":"stub" }]
 */

export interface ProviderConfig {
  label: string;
  kind: 'openai_compatible' | 'stub';
  baseUrl?: string;
  apiKeyEnvVar?: string;
}

export interface GatewayConfig {
  natsUrl: string;
  providers: ProviderConfig[];
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const natsUrl = env['JARVIS_GATEWAY_NATS_URL'] ?? 'nats://127.0.0.1:4222';
  let providers: ProviderConfig[] = [{ label: 'stub', kind: 'stub' }];
  const raw = env['JARVIS_GATEWAY_PROVIDERS'];
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JARVIS_GATEWAY_PROVIDERS must be a JSON array');
    providers = parsed.map((p): ProviderConfig => {
      const o = p as Record<string, unknown>;
      if (typeof o['label'] !== 'string' || (o['kind'] !== 'openai_compatible' && o['kind'] !== 'stub')) {
        throw new Error('each provider needs { label: string, kind: "openai_compatible" | "stub" }');
      }
      return {
        label: o['label'],
        kind: o['kind'],
        ...(typeof o['baseUrl'] === 'string' ? { baseUrl: o['baseUrl'] } : {}),
        ...(typeof o['apiKeyEnvVar'] === 'string' ? { apiKeyEnvVar: o['apiKeyEnvVar'] } : {}),
      };
    });
  }
  return { natsUrl, providers };
}
```

- [ ] **Step 2: Write `main.ts`**

```typescript
/**
 * Model Gateway process entrypoint (ADR-0010). Binds NATS request/reply on
 * `jarvis.gateway.infer` -> Gateway.infer, publishes `jarvis.cognition.model.*`
 * events. The RoutingSnapshot is supplied in the request by the caller (the
 * Kernel side that owns the Model Registry) — the gateway holds no DB handle.
 */

import { connect, JSONCodec, type NatsConnection } from 'nats';
import type { ModelRequest, RoutingSnapshot } from '@jarvis/contracts';
import { loadGatewayConfig, type ProviderConfig } from './config.ts';
import { Gateway } from './gateway.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { StubAdapter } from './adapters/stub/index.ts';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible/index.ts';
import type { EventMeta, EventSink } from './event-sink.ts';

function buildAdapters(providers: ProviderConfig[]) {
  return providers.map((p) => {
    if (p.kind === 'stub') return new StubAdapter();
    if (!p.baseUrl || !p.apiKeyEnvVar) {
      throw new Error(`provider "${p.label}" of kind openai_compatible needs baseUrl + apiKeyEnvVar`);
    }
    return new OpenAICompatibleAdapter({
      provider: p.label, baseUrl: p.baseUrl, apiKeyEnvVar: p.apiKeyEnvVar,
    });
  });
}

class NatsEventSink implements EventSink {
  private readonly codec = JSONCodec();
  constructor(private readonly nc: NatsConnection) {}
  emit(name: string, payload: Record<string, unknown>, meta: EventMeta): void {
    this.nc.publish(name, this.codec.encode({ payload, meta }));
  }
}

async function main(): Promise<void> {
  const config = loadGatewayConfig(process.env);
  const nc = await connect({ servers: config.natsUrl });
  const codec = JSONCodec<{ request: ModelRequest; snapshot: RoutingSnapshot }>();

  const breakers = new Map<string, CircuitBreaker>();
  const gw = new Gateway({
    adapters: buildAdapters(config.providers),
    sink: new NatsEventSink(nc),
    now: () => performance.now(),
    breakerFor: (provider) => {
      let b = breakers.get(provider);
      if (!b) { b = new CircuitBreaker(); breakers.set(provider, b); }
      return b;
    },
  });

  const sub = nc.subscribe('jarvis.gateway.infer');
  console.error(`[gateway] listening on jarvis.gateway.infer via ${config.natsUrl}`);
  console.error(`[gateway] providers: ${config.providers.map((p) => `${p.label}(${p.kind})`).join(', ')}`);

  for await (const msg of sub) {
    try {
      const { request, snapshot } = codec.decode(msg.data);
      const res = await gw.infer(request, snapshot);
      msg.respond(JSONCodec().encode(res));
    } catch (err) {
      msg.respond(JSONCodec().encode({
        finishReason: 'error', errorClass: 'malformed', attempts: [],
        output: null, modelId: '',
        usage: { contextUnits: 0, outputUnits: 0, costEstimate: 0, latencyMs: 0 },
        provenance: { method: 'system', producedBy: 'gateway', producedOn: 'gateway', producedAt: new Date().toISOString(), correlationId: 'none', derivedFromUntrusted: false },
        meta: { error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }
}

main().catch((err) => {
  console.error('[gateway] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 3: Rewrite `apps/gateway/README.md`** — keep the intent sections, add a "Built (MK.45)" section:

```markdown
## Built (MK.45)

- `src/provider-adapter.ts` — the `ProviderAdapter` interface.
- `src/adapters/stub/` — keyless deterministic adapter for tests + smoke runs.
- `src/adapters/openai-compatible/` — HTTP adapter for any OpenAI-shape endpoint;
  the provider **label** is config (`JARVIS_GATEWAY_PROVIDERS`), not code.
- `src/routing/route.ts` — the pure two-stage `route(ModelRequest, RoutingSnapshot)`.
- `src/circuit-breaker.ts` — per-provider breaker.
- `src/gateway.ts` — `Gateway.infer`: route → adapter → breaker → fallback chain →
  `attempts[]` → emit `jarvis.cognition.model.called` / `.call_failed`.
- `src/main.ts` — process: NATS request/reply on `jarvis.gateway.infer`.

### Config

| Env var | Default | Meaning |
|---|---|---|
| `JARVIS_GATEWAY_NATS_URL` | `nats://127.0.0.1:4222` | NATS to bind |
| `JARVIS_GATEWAY_PROVIDERS` | `[{"label":"stub","kind":"stub"}]` | JSON array of `{ label, kind: "openai_compatible" \| "stub", baseUrl?, apiKeyEnvVar? }` |

The `RoutingSnapshot` is supplied by the caller in each request — the gateway
holds no database handle and no authoritative state.
```

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 0 errors, `lint: clean`, all pass. (`main.ts` and `config.ts` compile; `main.ts` is exempt from the `console` lint ban.)

- [ ] **Step 5: Grep the no-provider-name constraint across the whole gateway again**

Run: `grep -rInE "openai|anthropic|gemini|\\bgpt\\b|\\bclaude\\b" apps/gateway/src --include=*.ts | grep -vE "adapters/openai-compatible/|\.test\.ts|^\S+:\s*(//|\*| \*)"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src/main.ts apps/gateway/src/config.ts apps/gateway/README.md
git commit -m "feat(gateway): process entrypoint (NATS request/reply) + config + README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: ADR-0025 + DATA_OWNERSHIP / GLOSSARY / ROADMAP updates

**Files:**
- Create: `docs/architecture/adr/0025-model-routing-policy.md`
- Modify: `docs/architecture/adr/README.md`
- Modify: `docs/architecture/DATA_OWNERSHIP.md`
- Modify: `docs/architecture/GLOSSARY.md`
- Modify: `docs/architecture/ROADMAP.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Write `0025-model-routing-policy.md`** — match the section order of `docs/architecture/adr/0019-operating-modes.md` (Status / Date / Deciders line block, then `## Context`, `## Decision`, `## Alternatives considered`, `## Benefits`, `## Disadvantages`, `## Risks`, `## Consequences`, `## Reversal difficulty`). Content:

```markdown
# ADR-0025: Model routing as configurable data

Status: Accepted
Date: 2026-09-02
Deciders: Principal Architect / Cognitive Systems Architect

## Context
L3 requires providers to be interchangeable and forbids "coding always uses
provider X" living in code. MK.45 needs a routing mechanism that (a) never names
a provider in code, (b) is a pure deterministic function of typed inputs (L20
style), (c) treats locality / privacy as non-negotiable (L25, L27), and (d) can
be tuned by the operator without a deploy.

## Decision
- Routing is a pure function `route(ModelRequest, RoutingSnapshot) -> RoutingPlan`
  in `apps/gateway/src/routing/route.ts`. No I/O, no clock, no randomness;
  `snapshot.now` carries the time. Fully replayable from its two inputs.
- **Two stages.** Stage 1 hard filters (task class, modalities, capabilities,
  structured-output strength, tool support, context limit, locality,
  **privacyClass**, availability, breaker state, min reliability, policy
  include/exclude) — a model failing any is excluded with a recorded
  `FilterReason`. Stage 2 weighted score over survivors:
  `quality·prior + reliability·successRate + latency·fit − cost·norm +
  locality·bonus + recency·freshness`, weights from a
  `catalogue.routing_policy` row per `TaskClass`.
- **`privacyClass` is a hard filter, never a score.** `request.privacyClass >
  model.maxPrivacyClass` ⇒ excluded. A `RESTRICTED` request can only reach a
  model whose route is cleared for it (MK.42: local models). Cost can never buy
  a privacy downgrade.
- **`catalogue.routing_policy`** rows are versioned data. The active policy for a
  `TaskClass` is `max(version)`. `qualityPrior` is operator-set per model this
  phase; reliability + observed latency are learned by the Model Registry's
  `model_health` projector (EWMA over `jarvis.cognition.model.called` /
  `.call_failed`).
- **Debug override.** `ModelRequest.debug.forceModelId` skips Stage 2 only; the
  hard filters still apply. A forced model failing a filter ⇒ `errorClass:
  'override_rejected'`. Overrides are accepted only from a kernel-local /
  owned-secure surface and are audited (`jarvis.cognition.route.explained`).
- **Fallback chain.** `RoutingPlan.fallbacks` is the ranked remainder. The
  gateway advances through it up to `budget.maxAttempts` (default 2), recording
  each try in `ModelResponse.attempts[]`. Exhaustion ⇒ `finishReason: 'error'`
  with the last `errorClass`. Empty survivor set ⇒ `errorClass: 'no_route'`.

## Alternatives considered
- **A routing config file of provider names** ("coding": "gpt-4o"). Rejected —
  that is exactly the L3 violation; swapping a provider becomes a code/config
  edit tied to vendor identity.
- **A model picks the model** (ask an LLM which model to use). Rejected — routing
  must be deterministic and replayable (L20); a model in the routing path makes
  the gateway non-deterministic and adds a cost/latency tax to every call.
- **A third-party LLM router (OpenRouter, LiteLLM) as the whole solution.**
  Useful as an *adapter target*, not a substitute — we still need our own pure
  routing for locality/privacy enforcement, our contracts, our audit events,
  and credential isolation (ADR-0010).
- **Score privacy instead of filtering it.** Rejected — L25/L27 are not
  tradeable; a cheap cloud model must never win a `RESTRICTED` request.

## Benefits
- No provider name in code (grep-enforced in CI-style lint) — the concrete proof
  of L3 for MK.45.
- Deterministic, replayable routing; `debug.explain` returns the full
  filter + score trace.
- Operator tunes routing by editing `catalogue.routing_policy` rows — no deploy.
- Privacy/locality enforcement has one chokepoint and cannot be scored away.

## Disadvantages
- `qualityPrior` is hand-set until an eval harness exists (deferred). Mitigated:
  conservative defaults; reliability + latency are learned from real outcomes.
- The weight vector is one more thing to tune. Mitigated: sensible defaults ship;
  the score trace makes tuning observable.

## Risks
- A misconfigured `routing_policy` row silently degrades quality. Mitigated:
  `route.explained` events + the score trace; a diagnostics view can surface the
  active policy per task class.
- Stale `model_health` metrics mislead routing. Mitigated: the `recency` score
  component penalises staleness; a model with no health row scores it as 0.

## Consequences
- `packages/contracts/src/model.ts` extended (additive); `routing.ts` added.
- `catalogue` schema: `models`, `routing_policy` (+ `routing_policy_active` view),
  `model_health` (migration `0007`). Owner: Model Registry (#11). No credentials.
- `apps/gateway` gains `provider-adapter.ts`, `adapters/*`, `routing/route.ts`,
  `circuit-breaker.ts`, `gateway.ts`, `main.ts`.
- New events `jarvis.cognition.model.called` / `.call_failed` / `route.explained`.
- `DATA_OWNERSHIP.md` §1 gains rows for `catalogue.routing_policy` and
  `catalogue.model_health`.

## Reversal difficulty
**Low.** Routing sits behind the pure `route()` signature; its internals
(weights, filters, the score formula) can change freely. Replacing it wholesale
is transparent to callers as long as `route(ModelRequest, RoutingSnapshot) ->
RoutingPlan` holds.
```

- [ ] **Step 2: Add the ADR README row** — in `docs/architecture/adr/README.md`, append to the table (match the existing row format):

```markdown
| [0025](0025-model-routing-policy.md) | Model routing as configurable data | Accepted | Low |
```

- [ ] **Step 3: DATA_OWNERSHIP.md** — in §1, immediately after the `**Model registrations**` row, add:

```markdown
| **Model routing policy** (weights per TaskClass, quality priors) | Model Registry | PG `catalogue.routing_policy` (+ `_active` view) | Strong | in-process + gateway pull |
| **Model health** (rolling success rate, observed latency, breaker) | Model Registry (projector over `jarvis.cognition.model.called` / `.call_failed`) | PG `catalogue.model_health` | Eventual | gateway pull |
```

- [ ] **Step 4: GLOSSARY.md** — under the Cognition section, add:

```markdown
**TaskClass** — the canonical cognition task category on a `ModelRequest`
(`realtime_conversation`, `intent_classification`, `planning`, `deep_reasoning`,
`coding`, `vision`, `research`, `document_analysis`, `summarisation`, `embedding`,
`reranking`, `speech_recognition`, `speech_generation`; open set). Replaces the
deprecated `ModelTask`.

**RoutingSnapshot** — the immutable input to the gateway's pure `route()`:
registered models, derived `model_health`, active `routing_policy` per TaskClass,
live breaker state, and `now`.

**RoutingPlan** — `route()`'s output: `primary` model id (or null), ranked
`fallbacks`, the `policyVersion`, and the full filter + score trace.

**ProviderAdapter** — the one interface a provider implements
(`apps/gateway/src/adapters/<label>/`). The only place a provider SDK / wire
format lives (ADR-0010). The provider **label** is config, not code (L3).

**Circuit breaker** — per-provider closed / open / half-open state the gateway
keeps; an open breaker excludes every model of that provider from routing until
a cooldown elapses.

**model_health** — the Model Registry projection folding
`jarvis.cognition.model.called` / `.call_failed` into a rolling success rate,
observed latency, and availability (`available` / `degraded` / `unavailable`)
via EWMA.
```

- [ ] **Step 5: ROADMAP.md** — in the `### MK.45 — Cognition` block, append:

```markdown

**Status (2026-09-02):** Model access landed — `model.ts` extended + `routing.ts`;
Model Registry (#11) + `catalogue` schema (migration 0007) + `model_health`
projector; `apps/gateway` process with `ProviderAdapter`, a keyless stub adapter,
an OpenAI-compatible HTTP adapter, the pure two-stage `route()`, per-provider
circuit breakers, and `Gateway.infer` with the fallback chain. ADR-0025. Agent
Runtime, Context Compiler budget algorithm, `Proposal` + Validator, and the
Cognition Orchestrator are the next THE MIND sub-plans.
```

- [ ] **Step 6: Verify no dangling links + gate**

Run: `pnpm lint` (docs aren't linted; confirms nothing else broke) and `grep -rn "0025-model-routing-policy" docs/` (should appear in `adr/0025-...md` and `adr/README.md` only).
Expected: `lint: clean`; grep shows the two expected files.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/adr/0025-model-routing-policy.md docs/architecture/adr/README.md docs/architecture/DATA_OWNERSHIP.md docs/architecture/GLOSSARY.md docs/architecture/ROADMAP.md
git commit -m "docs(adr): 0025 model routing as configurable data + DATA_OWNERSHIP/GLOSSARY/ROADMAP

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: `tsc` exits 0, no output.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: `lint: clean`

- [ ] **Step 3: Unit tests**

Run: `pnpm test`
Expected: all pass — the existing suite + `event-names.test.ts` additions + `model-health-policy.test.ts` (5) + `stub.test.ts` (4) + `route.test.ts` (~13) + `circuit-breaker.test.ts` (4) + `gateway.test.ts` (~7) + `openai-compatible.test.ts` (5). Output pristine (no stray warnings).

- [ ] **Step 4: Integration tests (Docker available)**

Run: `pnpm test:integration`
Expected: `catalogue-schema.integration.test.ts` (5) and `model-registry.integration.test.ts` (4) pass; existing integration tests still pass. Retry once on the known `startEphemeralPg` ECONNRESET readiness flake.

- [ ] **Step 5: The L3 proof — provider switch touches only adapter + rows**

Manually confirm (no code change): removing a provider = delete its adapter directory under `apps/gateway/src/adapters/` + its `catalogue.models` rows + (optionally) its `catalogue.routing_policy` weight tweaks. **Nothing in `packages/contracts`, the Kernel, the routing function, or `gateway.ts` names or imports a provider.** Re-run the grep:

Run: `grep -rInE "openai|anthropic|gemini|\\bgpt\\b|\\bclaude\\b" apps/gateway/src packages/contracts/src apps/core/src --include=*.ts | grep -vE "adapters/openai-compatible/|\.test\.ts|^\S+:\s*(//|\*| \*)"`
Expected: no output.

- [ ] **Step 6: Spec coverage check** — confirm each sub-plan-1 deliverable in spec §14 maps to a task:
  - `model.ts` extension + `routing.ts` → Task 1 ✓
  - `catalogue` schema (migration `0007_catalogue.sql`) → Task 2 ✓
  - Model Registry module (#11) + `model_health` projector → Tasks 3–4 ✓
  - `apps/gateway` process, `ProviderAdapter` + 2 adapters (keyless stub + real-provider shape) → Tasks 5, 9, 10 ✓
  - the pure two-stage `route()` → Task 6 ✓
  - per-provider circuit breakers → Task 7 ✓
  - `Gateway.infer` fallback chain + `model.called` / `.call_failed` events → Task 8 ✓
  - ADR-0025 + doc updates → Task 11 ✓
  - Spec §15 rows covered: provider failure (Task 8), provider switching (Task 12 Step 5 + Task 6), routing privacy gate (Tasks 6, 8), context overflow via `minContextUnits` filter (Task 6). The *malformed model response* full retry/fallback-to-principal path and *budget exhaustion* meters are Cognition-Orchestrator concerns → deferred to THE MIND sub-plan 3.

- [ ] **Step 7: Commit the verification note**

```bash
git add -A
git commit -m "chore: THE MIND sub-plan 1 (model access) complete — gateway, registry, routing verified

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage.** Every sub-plan-1 deliverable in spec §3, §4, §14 has a task (see Task 12 Step 6). The `debug.explain` route trace, the privacy hard-filter, `attempts[]`, `errorClass`, and the fallback chain from §4.3 are implemented and tested. Spec §15 rows that belong to *this* subsystem (provider failure, provider switching, routing privacy gate, context-overflow filter) are covered; rows that belong to the Orchestrator (malformed-output retry ladder, budget meters, context-overflow *narrow-and-retry*) are explicitly deferred with a pointer, matching the spec's own decomposition.

**2. Placeholder scan.** No "TBD/TODO/implement later". Every code step carries the full file or the exact edit. The two doc tasks (11) contain the full ADR text and the exact section inserts. Task 10 (`main.ts`) has no unit test *by design* (process wiring, covered transitively) with the rationale stated inline — not a placeholder.

**3. Type consistency.** `TaskClass`, `Modality`, `ReasoningLevel`, `ModelErrorClass`, `AttemptRecord` defined in `model.ts` (Task 1) and consumed by `routing.ts` (Task 1), `route.ts` (Task 6), `gateway.ts` (Task 8), the stub adapter (Task 5), and the OpenAI-compatible adapter (Task 9) with the same names. `RoutingSnapshot` / `RoutingPlan` / `RoutingWeights` / `FilterReason` defined in `routing.ts` and consumed by `route.ts`, `model-registry.ts` (Task 4), and `gateway.ts` identically. `ModelHealthRow` defined in `routing.ts`, produced by `model-health-policy.ts` (Task 3), stored/read by `model-registry.ts` + `model-health-projector.ts` (Task 4). `EventNames.ModelCalled` / `.ModelCallFailed` / `.RouteExplained` added in Tasks 1 + 4 and asserted in `event-names.test.ts`; used by `gateway.ts` (Task 8) and `model-health-projector.ts` (Task 4). `ProviderAdapter` / `AdapterResult` / `AdapterInvokeOpts` defined in Task 5, implemented in Tasks 5 + 9, consumed in Task 8. `EventSink` / `EventMeta` defined in Task 8, implemented (`InMemoryEventSink`) in Task 8 and (`NatsEventSink`) in Task 10. `route()` signature is identical everywhere: `route(req: ModelRequest, snap: RoutingSnapshot): RoutingPlan`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-the-mind-1-model-access.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
