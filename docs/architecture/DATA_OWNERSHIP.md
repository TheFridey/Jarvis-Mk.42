# Data Ownership

The definitive owner of every category of state in JARVIS. **There is exactly
one owner per category.** Ambiguous ownership is an architectural defect; this
document exists to make it impossible.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md),
[`KERNEL_CONSTITUTION.md`](KERNEL_CONSTITUTION.md).

---

## 1. Ownership table

"Owner" = the single component allowed to write it. "Store" = where the
authoritative copy lives. "Consistency" = the guarantee the owner provides.
"Cache" = where a reconstructible copy may be served from.

| Category | Owner | Store | Consistency | Cache allowed |
|---|---|---|---|---|
| **Identity — principals** | Identity Manager | PG `identity.principals` | Strong | Redis (short TTL) |
| **Identity — credential metadata** (not secrets) | Identity Manager | PG `identity.credentials` | Strong | none |
| **Secrets / API keys** | *Not in PostgreSQL.* Gateway holds provider keys in its process env / OS keychain; adapters hold their own scoped tokens; Kernel holds DB + NATS creds. | OS keychain / env / secrets file | n/a | none |
| **Users (future multi-user)** | Identity Manager | PG `identity.principals` (`principalId` already the scope key everywhere) | Strong | Redis (short TTL) |
| **Sessions — records** | Session Manager | PG `session.sessions` | Strong | — |
| **Sessions — liveness** (connected now?) | Session Manager | Redis `sess:live:*` | Ephemeral | n/a (is the cache) |
| **Realtime runtime state** (locks, leases, rate limits, UI pub/sub) | the component holding the lease | Redis | Ephemeral | n/a |
| **Events (the Event Log)** | Event Manager | PG `events` (partitioned by class + time) | Strong, append-only, ordered per subject | NATS JetStream (replay buffer, not authority) |
| **Projected State** (objective status, active grants, registered caps/models, node registry, presence projections) | State Manager (runs the projectors) | PG `projections.*` | Strong, single-writer per read model | Redis (opt-in, per read model) |
| **Objectives** (definition, decomposition, success criteria, status) | Objective Engine | PG `projections.objectives` + `events` | Strong, serialised per objective id | — |
| **Tasks** (units of scheduled/dispatched work) | Scheduler (schedule + dispatch state); Agent Runtime (execution lease) | PG `projections.tasks` + Redis leases | Strong for schedule; Ephemeral for lease | Redis |
| **Permissions / grants / scopes** | Permission Engine | PG `projections.grants` + `events` | Strong | none (security-critical; always read fresh) |
| **Authority tokens** (minted, scoped, TTL) | Permission Engine | Redis `auth:tok:*` (short TTL) + issuance event in `events` | Ephemeral token, durable issuance record | n/a |
| **Policies** (rules) | Policy Engine | PG `policy.rules` (versioned) | Strong | in-process (rebuilt on version bump) |
| **Policy decisions** (the audit of each decision) | Policy Engine → Audit Manager | `events` → PG `audit.*` | Strong, append-only | — |
| **Capabilities** (manifests, versions) | Capability Registry | PG `catalogue.capabilities` | Strong | in-process |
| **Model registrations** | Model Registry | PG `catalogue.models` | Strong | in-process + gateway pull |
| **Agents** (roster manifests) | source-controlled in `agents/*`; **agent lease/run records** | Agent Runtime | PG `projections.agent_runs` + Redis leases | Redis |
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
| **Scene state** (spatial abstraction: surfaces, node positions, entity spatial extent) | Scene service (`packages/scene`), a Kernel module | PG `scene.*` for durable placement; Redis for live positions | Strong for durable placement; Ephemeral for live | Redis |
| **Spatial state** (transient: current gaze target, cursor dwell, hand pose) | Perception (emits) → Context Compiler (consumes); **not persisted** beyond signal-event window | `events` (signal class) | Ephemeral | n/a |
| **Node state — registry** (a node exists, its declared sensors/caps, trust tier, owner) | Presence Manager | PG `projections.nodes` | Strong | — |
| **Node state — liveness** (heartbeat, RTT, current subscriptions) | Presence Manager | Redis `node:live:*` | Ephemeral | n/a |
| **Presence** (is the principal here, on which node/surface) | Presence Manager | PG `projections.presence` (history) + Redis (current) | Eventual | Redis |
| **Audit state** | Audit Manager | PG `audit.*` (append-only) | Strong, append-only | — |
| **Notifications** (intent + delivery state) | Notification Manager | PG `projections.notifications` | Strong | Redis (unread counts) |
| **Health state** | Health Manager | Redis (current) + `events` (transitions) | Ephemeral current, durable transitions | n/a |
| **Telemetry** (traces/metrics/logs) | OTel collector / backend | outside PostgreSQL | best-effort | n/a |
| **Blobs** (screenshots, clips, artefacts, exports) | the producing component owns the *reference*; bytes in object storage | MinIO | immutable objects | CDN/local (future) |

**Knowledge Ingestion** is the single writer to `atlas.*` and `mnemosyne.*` — a
Kernel-internal protected service (Executor-class), not a frozen-16 component
(ADR-0020). Perception, cognition, agents, and interfaces reach it only via
observations, validated proposals, or principal-assertion commands.
`working` / `session` / `spatial` memory are NOT MNEMOSYNE-owned: they remain
with the Ephemeral store, Session Manager, and Scene service respectively.

## 2. Strong vs eventual — where each is required

### Strong consistency is mandatory for:

- **Permission grants and authority tokens.** A revoked grant must not be
  usable. The Executor reads grant state fresh, inside the transaction that
  writes `capability.started` (freshness barrier, review §16.10).
- **Policy rule versions.** A decision must use one coherent rule set.
- **Objective status transitions.** Serialised per objective id; no two
  writers.
- **Event Log append + ordering per subject.** The ledger cannot have gaps or
  reordering within a subject.
- **Catalogue registration** (capabilities, models, nodes). A half-registered
  capability must not be invokable.
- **Audit append.** No lost audit records.
- **Identity.** Who a principal is.

### Eventual consistency is acceptable for:

- **World Model facts and the evidence graph.** A newly ingested fact may take
  seconds to appear in queries. Reasoning tolerates this and receives a
  freshness hint in the `ContextFrame`.
- **Memory.** Recall over a slightly stale index is fine.
- **Presence.** "Principal seen 4 s ago on workstation" is good enough.
- **Notification unread counts, health dashboards, telemetry.**
- **Scene live positions** (gaze, cursor, hands) — inherently transient.

### Redis may cache (never own):

Session liveness, node liveness, authority tokens (with durable issuance
record), presence-current, notification unread counts, rate-limit counters,
locks/leases, health-current, and opt-in read-model snapshots. **Every one is
reconstructible** from PostgreSQL + live reconnection. Losing Redis degrades
latency and forces re-derivation; it never loses authoritative data
(`FAILURE_MODEL.md` §Redis).

### PostgreSQL is the authority behind everything.

If a value matters after a reboot, it is in PostgreSQL. Full stop.

## 3. Cross-domain access rule

No component reads or writes another component's schema. Data crosses a
boundary as:

1. an **event** (preferred for facts-of-what-happened and fan-out), or
2. a call to the owner's **service interface** (for a synchronous query or a
   command).

Direct `SELECT` across schemas, shared table access, and "just add a foreign
key into their table" are prohibited. This is enforced by per-schema database
roles: each Kernel module connects with a role that can touch only its own
schema plus read-only access to `events`.

## 4. `principalId` scoping (multi-user readiness, L34)

Every authoritative row that concerns a principal carries a non-null
`principalId`. MK.42 has one principal, so it is a constant — but the column,
the indexes, and the policy predicates exist now. Going multi-user is:

- issue more principals (Identity Manager already supports it),
- add per-principal policy rules and grants (data),
- add row-level filters in read APIs keyed on the requesting principal.

No schema migration of existing tables. No new infrastructure. This is why
"single operator, multi-user-ready" costs almost nothing.

## 5. Ownership disputes — resolution procedure

If two components appear to need to write the same thing:

1. Identify the **single question** the data answers. The component whose
   responsibility *is* that question owns it.
2. If both genuinely need to write, the data is actually **two categories** —
   split it (as done for session-liveness vs presence, node-registry vs
   node-liveness, schedule-state vs execution-lease).
3. If it still cannot be split, one component owns it and the other emits a
   **command** to that owner.
4. Record the resolution here. This document is the registry of such
   decisions.
