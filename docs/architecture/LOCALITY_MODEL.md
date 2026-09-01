# Locality Model

What runs on-device, on the local server, and in cloud — and why (L25–L27,
L36, L39).

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md).

---

## 1. Placement principles

1. **Realtime, simple perception → on-device.** Wake word, VAD, ASR, hands,
   pose, presence. Latency and privacy demand it (L25).
2. **Privacy-sensitive → local.** Continuous camera/mic never leave the
   workstation (L27). Personal data stays on the local server.
3. **Low-latency interaction loop → local.** Intent resolution, policy,
   permission, state writes all happen on the local server with no cloud
   round-trip on the critical path.
4. **Authoritative state → local server, always.** PostgreSQL, Redis, NATS,
   object storage. No authoritative component in cloud (L26).
5. **Heavy frontier reasoning → cloud, as a resource.** Via the Model Gateway.
   Replaceable, optional, degradable (L3, L39).
6. **Local models where valuable → local server or GPU node.** Same Model
   Registry, `locality: local` (L36).

## 2. MK.42 placement table

| Workload | Node | Rationale |
|---|---|---|
| Tauri desktop shell, multi-monitor UI | Workstation | Experience surface |
| Voice process (VAD, wake, ASR, prosody) | Workstation | Realtime + privacy (L25, L27) |
| Vision process (presence, hands, pose, tags) | Workstation | Realtime + privacy; raw frames never leave |
| Screen/app/cursor telemetry collector | Workstation | Source is here |
| `windows` capability adapter | Workstation | Controls this machine's OS |
| Diagnostics UI | Workstation | Operator surface; must run when server is sick |
| **Kernel** (`apps/core`, all 16 components) | Local server | The spine; always-on |
| **Model Gateway** | Local server | Egress point; holds provider keys; near the Kernel |
| PostgreSQL (+ pgvector) | Local server | Authority |
| Redis | Local server | Ephemeral, near the Kernel |
| NATS JetStream | Local server | Transport, near the Kernel |
| Object storage (MinIO) | Local server | Blobs |
| OTel collector | Local server | Telemetry sink |
| `filesystem`, `terminal`, `github`, `docker`, `web`, `browser`, `scalesmiths` adapters | Local server (default) or workstation per resource | Placed where the resource lives |
| Agents (`oracle`, `forge`, …) | Local server worker pool | Orchestrated by Agent Runtime; CPU + gateway access |
| Frontier model inference (OpenAI/Anthropic/Gemini/…) | **Cloud** | Computational resource only (L26) |
| Local model inference (optional in MK.42) | Local server CPU/GPU | `locality: local` registry entry |

## 3. `locality` on `ModelRequest`

Cognition sets a `locality` constraint per request; the gateway honours it:

| Value | Meaning |
|---|---|
| `local` | Must run on a local/GPU-node model. If none available/healthy ⇒ `finishReason: error`, cognition degrades (asks principal, defers). |
| `prefer-local` | Try local first; fall back to cloud if local can't meet `capabilities`/`budget`. |
| `any` | Route by cost/latency/quality with no locality preference. |
| `cloud-ok` | Explicitly fine to leave the LAN (default for heavy reasoning). |

Privacy-classified context (flagged by the Context Compiler when the frame
contains sensitive personal/business facts) forces `locality` to at least
`prefer-local` regardless of the requested value, and forbids `cloud-ok`
without an explicit HIGH-risk capability approval.

## 4. Degradation when cloud / internet is unavailable (L39)

| Loss | Effect | Behaviour |
|---|---|---|
| Internet down | No cloud models, no external capabilities | Kernel runs fully. Cognition routes to local models if registered; else queues non-urgent cognition and tells the principal "reasoning is limited — offline". Perception, state, objectives, local capabilities, audit all normal. |
| One provider down | That provider unavailable | Gateway circuit-breaks it, routes to next-best; if none matches ⇒ error handled by cognition. |
| All providers down, no local model | No heavy reasoning | JARVIS still: perceives, tracks presence, records events, serves state, runs deterministic policy, executes already-approved local capabilities, answers from Memory/World Model with templated responses, defers reasoning-dependent work. |

The identity and authority of JARVIS are entirely local; cloud loss reduces
*intelligence available*, never *what JARVIS is*.

## 5. Future locality (nodes attach via Node Protocol)

| Future node | Adds locally | Notes |
|---|---|---|
| GPU / edge node | Heavier local inference, heavier vision models | New `locality: local` registry entries; publishes same observation types |
| Phone / tablet | Mobile presence, location, voice intent, a mobile Experience surface | `owned-mobile` trust tier |
| TV / display node | A presentation surface, ambient display | `owned-secure` or `guest` |
| AR headset | pose/gaze/hands observations, a spatial-UI surface | Scene Graph already exists (L32, L37) |
| Robot / device controller | CRITICAL-heavy capabilities, motion, physical sensors | Executor pipeline already gates it (L38) |

None require a Kernel change — only registry data, capability manifests,
observation types, and (for a new physical class) a Node Protocol version
negotiation.

## 6. Network assumptions

- MK.42 assumes a **reliable LAN** between workstation and local server.
  Workstation↔server uses mTLS WebSocket/NATS.
- Node↔Kernel is designed to tolerate **unreliable/high-latency** links
  (mobile, edge) from day one: heartbeats, scoped subscriptions, local
  spooling, idempotent delivery. That is why `apps/relay` exists as a seam —
  when nodes live off-LAN, `relay` terminates their connections at the edge.
