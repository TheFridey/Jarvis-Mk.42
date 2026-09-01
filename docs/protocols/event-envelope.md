# Protocol: Event Envelope (v1, amended per ADR-0009 Amendment 1)

Normative shape of every event. TypeScript type: `packages/contracts/src/event.ts`.
Runtime schema: `packages/validation`. Governance:
`docs/architecture/EVENT_ARCHITECTURE.md` + ADR-0009.

## Fields

| Field | Type | Rule |
|---|---|---|
| `id` | string (ULID) | Globally unique, time-sortable. Idempotency key for all consumers. |
| `type` | string | `jarvis.<plane>.<domain>.<name>`, lower-case, dot-delimited, stable. Renames = new type. |
| `schemaVersion` | integer >= 1 | Bumped on any `payload` change. Consumers quarantine unknown-higher versions, never crash. |
| `retentionClass` | `TRANSIENT` \| `OPERATIONAL` \| `AUDIT` \| `MEMORY_CANDIDATE` \| `SECURITY` \| `DIAGNOSTIC` | Storage policy, fixed at append (`EVENT_ARCHITECTURE.md` sec 2.1). Immutable; elevate by re-emitting. |
| `time` | RFC3339 UTC | When it occurred (producer clock). |
| `recordedAt` | RFC3339 UTC | When the Kernel persisted it (Kernel clock). |
| `source.node` | string | Node id that produced it. |
| `source.component` | string | Component / adapter / agent id. |
| `subject.kind` | string | Aggregate type the event is ordered within (`objective`, `grant`, `session`, ...). |
| `subject.id` | string | Aggregate id. **Per-subject order is guaranteed; global order is not.** |
| `actor.kind` | `"principal"` \| `"agent"` \| `"system"` \| `"node"` | Who/what caused it. |
| `actor.id` | string | Identity of the actor. |
| `actor.onBehalfOf` | string? | `principalId` when `actor.kind = "agent"`. |
| `provenance` | Provenance | Mandatory (L11). Method, model id+version if any, source refs, producing `correlationId`, `derivedFromUntrusted`. |
| `causationId` | string | The event/command that **directly** caused this one. |
| `correlationId` | string | Stable id for the **whole** interaction. Minted by the ingress component (`EVENT_ARCHITECTURE.md` sec 6). |
| `principalId` | string | Scoping key (L34). Constant in MK.42. |
| `privacyClass` | `PUBLIC` \| `INTERNAL` \| `SENSITIVE` \| `RESTRICTED` | **Required.** Confidentiality band; drives Context Compiler filtering + cross-node propagation. `RESTRICTED` never leaves its origin node without a HIGH-risk capability. |
| `traceId` | string? | OTel trace id (promoted from `meta` in Amendment 1). |
| `location` | `{ spaceId: string; ref?: string }`? | Where it occurred, when meaningful. |
| `confidence` | number? | 0..1, for events carrying an estimate. |
| `evidence` | string[]? | Supporting event ids / source refs. |
| `expiresAt` | RFC3339 UTC? | Retention hint beyond the class default. |
| `payload` | object | Type-specific, validated against `type` + `schemaVersion` at append time. Malformed => rejected, never stored. |
| `meta` | object? | Non-authoritative hints only (`replay`, ...). Never acted on as data. |

## Guarantees

- **Ordering**: strict per `subject.id`; none across subjects. Cross-aggregate
  consistency uses sagas, not global order.
- **Delivery**: at-least-once via JetStream. Consumers idempotent on `id`.
- **Durability**: for every `retentionClass` except `TRANSIENT`, the row in
  PostgreSQL `events` is the record of truth; JetStream is a bounded recent
  buffer. `TRANSIENT` events are never persisted.
- **Validation**: the Event Manager rejects an event failing its schema at
  append time (structural + per-`type` payload schema).
- **Replay != re-execution**: replayed events (`meta.replay=true`) reach only
  pure projector consumers via the `ReplayBus`; effect-causing consumers reject
  them.

## Versioning

- Add optional field -> `schemaVersion` bump, backward compatible.
- Remove/retype field -> new `type` or major `schemaVersion` + a translation
  consumer during migration.
- `id` / `type` grammar, the `retentionClass` and `privacyClass` enums, and the
  ordering guarantee are frozen for v1; changing them is an ADR
  (`EVENT_ARCHITECTURE.md` is subordinate to `PRINCIPLES.md`).
