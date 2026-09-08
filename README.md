# JARVIS MK.42

A persistent, event-driven artificial-intelligence **operating layer**.

Not a chatbot. Not an LLM wrapper. Not a collection of agents. JARVIS is the
identity, state, event fabric, world model, memory, objectives, policy,
permission, capability, routing, orchestration, perception, planning,
execution, verification, and audit layer that *uses* replaceable AI providers
as cognitive resources.

> **The models are not JARVIS.** OpenAI, Anthropic, Gemini, local models, TTS,
> vision — all replaceable. JARVIS is what persists around them.

## Current status — MK.42 RC1

Certified by an independent hostile release-candidate audit
(`docs/architecture/MK42_RELEASE_CANDIDATE_AUDIT.md`, 2026-09-08), which read the
code rather than the claims, ran every gate against real infrastructure, and
attempted the forbidden operations. **Verdict: GO for `mk42-rc1`.** Read that
document for scores, the exact commands, and the debt list.

RC1 ships:

1. The **architectural constitution** — `docs/architecture/`
2. **Architecture Decision Records** — `docs/architecture/adr/`
3. **Diagrams** — `docs/architecture/diagrams/`
4. A running modular Kernel (`apps/core`) with durable events (NATS JetStream + transactional outbox), single-writer state, identity, sessions, health, and a real Agency Plane: policy, permission, approval, credential broker, durable invocation lifecycle, verified execution, and rollback all backed by Postgres and enforced end-to-end — no bypass of the single Executor pipeline was found under adversarial review.
5. A working cognition path: provider-neutral Model Gateway (Anthropic/OpenAI/OpenAI-compatible behind one interface, secrets kept in the gateway process), an Objective Engine that can reason/plan/propose but never execute directly, and malformed/off-scope model output that is schema-rejected before it can become an action.
6. Voice and vision **code paths** that are real and covered by unit + integration tests: Kernel-owned voice session state with barge-in and device-loss handling; frames stay local by default; cloud vision requires an explicit approved selected-frame path; Air Touch gestures are signal-only and route through the same approval pipeline as everything else; ambiguous gestures never become actions. **The hardware capabilities themselves are NOT independently verified** — see "Not proven" below.
7. **ATLAS (temporal world model) and MNEMOSYNE (memory)** — implemented for real (MK.46, ADR-0039), runtime under `apps/core/src/kernel/{atlas,mnemosyne,knowledge,embedding}`: first-class entities / relationships / temporal facts with provenance, epistemic status and confidence; contradiction recording (never silent overwrite); observation→fact promotion; eight memory classes with a candidate-scoring gate; seven-factor recall with a bounded similarity weight; scheduled DREAMING consolidation (deterministic, proposals-only). Both are load-bearing Context Compiler sources, fused there and nowhere else, behind a single Knowledge Ingestion writer. Cognition now routes model locality by the context's `maxPrivacyClass` and fails closed on RESTRICTED with no local route.
8. **Session-bound access credentials.** Every `/desktop/*`, `/voice/*` and `/vision/*` request presents a credential minted at `/auth/session` and bound to an admitted node, a live session and an explicit scope. Logout, session end, identity revocation, principal disable and node revocation all invalidate it immediately; rotation retires the previous generation; approvals additionally require a `strong` credential issued within five minutes. The earlier "tokens are not invalidated on logout" gap is **closed**.
9. **Real observability.** A registered OpenTelemetry `NodeSDK` with OTLP export and resource identity; `currentTraceId()` returns a genuine trace id and the Event Manager stamps it onto the durable `events.events` row, so the ledger joins to the trace. Span coverage is partial — see below.
10. **Real disaster recovery.** `pnpm backup:drill` takes a `pg_dump -Fc` artifact, drops and recreates the database, runs `pg_restore --exit-on-error`, asserts Kernel state / ATLAS / MNEMOSYNE / objectives / agency-invocation / policy rows survived, boots a real Kernel against the restored database, and confirms a completed invocation is not re-executed. It hard-fails when Docker is absent.
11. Typed, runtime-validated contracts plus unit, integration (real ephemeral Postgres — the gate now hard-fails rather than self-skipping without Docker), contract, security, fitness and chaos gates, all green in CI on every push to `main`.
12. A Tauri/Next.js desktop experience prototype and an isolated capability-worker host whose replies are bound by a per-invocation HMAC + nonce + staleness check (worker spoofing, stale replies and wrong-invocation replies are structurally rejected).

**Known gaps, stated plainly:**

- **Node Protocol v1 (ADR-0037) is a library, not an operating protocol.** The persisted registry, single-use enrollment tokens with a trust ceiling (`kernel-local` can never be requested), key rotation with overlap, revocation cascading to credentials, and a scheduled liveness sweep are all real and unit-tested. There is **no `/nodes/*` ingress**, so no remote node can enroll or heartbeat over the wire; the only registered node is the composition root. Every event's `source.node` is still the static `nodeId`.
- **Span coverage is partial.** Only two Kernel paths create explicit spans (`model_gateway.generate`, `agency.executor.invoke`). The registered `instrumentation-pg` is **inert** — it patches `node-postgres` while this repo uses `postgres.js` — and outbound `fetch` (undici) has no instrumentation. An interaction touching neither instrumented path carries no trace id.
- **The chaos gate does not inject faults into a live Kernel.** It proves the host-level fault-injection mechanisms work and covers Kernel degradation logic deterministically; it does not kill NATS/Redis/Postgres underneath a running Kernel and observe recovery.
- **Verification reads through the same adapter module it is checking.** The Executor owns the strategy and the comparison, so an adapter can never self-certify completion — but a fully malicious adapter could lie consistently in both the execute and the verify read. A verification world outside the adapter is future work.
- **The bootstrap credential is the single root of trust.** `authStrength: 'strong'` is asserted by the ingress, not proven by a second factor; there is no MFA. The default is `dev-bootstrap-secret` and nothing refuses to start when it is combined with a non-loopback bind. `/diagnostics` and `/state` are unauthenticated on loopback.
- **Privacy classes are caller-asserted.** The mediator defaults everything to `INTERNAL` and only guarantees that untrusted-derived material never becomes `PUBLIC`; there is no content-aware sensitivity detection. Labels are enforced hard once set: two independent layers (Kernel routing and the Model Gateway registry) keep `SENSITIVE`/`RESTRICTED` context away from cloud models, and fail closed when no local route exists.
- **Knowledge-plane embeddings** are the deterministic `deterministic-hash-v1` client (offline, reproducible), not a model — similarity is one bounded recall factor. DREAMING runs deterministic rules only (no `mnemosyne` agent yet).

**Not proven — do not treat as working:**

- Microphone capture, speech recognition, wake word, audible TTS, conversation
  follow-up, barge-in and acoustic echo self-trigger **against real hardware**.
- MediaPipe hand tracking, Air Touch gestures, selected-frame cloud vision, and
  device loss/reconnect **against real hardware**.
- Multi-monitor behaviour; the end-to-end "Jarvis — what's that?" voice + gesture
  + scene composition.
- Live cloud provider calls (no API keys are configured in the audited build).

`pnpm hardware:validate` enumerates device *presence* only and marks every one of
the above `NOT TESTED`. Presence is not capability.

This is a hardened agency-plane foundation with a real knowledge plane, working
cognition, and honest instrumentation — not a finished assistant, and not yet
distributed (single-node only).

## Read in this order

1. [`docs/architecture/PRINCIPLES.md`](docs/architecture/PRINCIPLES.md) — the 40 laws
2. [`docs/architecture/MK42_ARCHITECTURE.md`](docs/architecture/MK42_ARCHITECTURE.md) — the whole system in one document
3. [`docs/architecture/KERNEL_CONSTITUTION.md`](docs/architecture/KERNEL_CONSTITUTION.md) — what the Kernel is and is not
4. [`docs/architecture/README.md`](docs/architecture/README.md) — index of every model document
5. [`docs/architecture/GLOSSARY.md`](docs/architecture/GLOSSARY.md) — precise vocabulary

## Structure

| Path | Purpose |
|---|---|
| `apps/` | Deployable processes. `core` = Kernel. `gateway` = Model Gateway. `voice`/`vision` = perception. `desktop` = Tauri shell. `diagnostics` = operator UI. `relay` = future edge node (empty seam). |
| `packages/` | In-repo libraries consumed by apps. `contracts` = shared types. `kernel` = Kernel module code. See `packages/README.md`. |
| `agents/` | Disposable cognitive-worker manifests. The full Agent Runtime remains incomplete. |
| `capabilities/` | Permissioned effect manifests; selected providers include executable adapters. Every consequential action must pass through the Kernel Executor. |
| `infrastructure/` | Docker Compose, Postgres, Redis, NATS, observability configuration. |
| `docs/` | Architecture, ADRs, protocols, security, diagrams. |

## Deployment target for MK.42

One developer **workstation** (Tauri desktop app + perception) plus one
always-on **local server** on the LAN (Kernel, Postgres, Redis, NATS, object
storage), orchestrated with Docker Compose. Cloud is used **only** for frontier
model APIs, reached through the Model Gateway. GPU / edge / AR / robotics nodes
are future node types that attach through the Node Protocol without a Kernel
rewrite.
