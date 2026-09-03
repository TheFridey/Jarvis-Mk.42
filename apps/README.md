# apps/

Deployable processes. MK.42 runs six; `relay` is an empty extraction seam.

| App | Node | What it is | Separate process because |
|---|---|---|---|
| `core` | local server | **The Kernel.** All 16 components as Nest modules; the modular monolith (ADR-0008). Sole writer of authoritative state. | — (it is the monolith) |
| `gateway` | local server | **The Model Gateway.** Sole inference egress; holds provider API keys; provider adapters. | Blast radius + credential isolation + slow network IO (L26) |
| `voice` | workstation | Realtime audio: VAD, wake word, ASR, prosody. Emits `jarvis.perception.*` signals. | Hard-realtime loop; raw audio stays local (L25, L27) |
| `vision` | workstation | Realtime vision: presence, hands, pose, scene tags. Emits signals. | Hard-realtime loop; GPU/native deps; raw frames stay local (L27) |
| `desktop` | workstation | **The Experience shell.** Tauri + React/Next.js. Consumes state via `@jarvis/sdk`; owns no authoritative state (L6). | User-session lifecycle |
| `diagnostics` | workstation | Operator read-only UI over Kernel APIs: events, audit traces, health, approvals. | Must run to inspect a sick Kernel |
| `relay` | edge | **Empty in MK.42.** Documented seam: terminates Node Protocol connections for nodes that live off-LAN (`ROADMAP.md` MK.51+). | Future |
| `adapter-host` | local server + workstation | **The Agency worker runtime** (HEPHAESTUS, ADR-0025). Spawns one zero-environment Node worker per capability invocation (`riskClass >= MEDIUM`); receives a per-invocation credential handle; typed IPC to the Executor only; holds no store credential. | Blast radius: a compromised adapter is one out-of-process invocation with a narrowly-scoped, short-lived credential (L18, L30) |
| `labs` | local server | **JARVIS LABS** (HEPHAESTUS, ADR-0029). Isolated experimentation sandbox — ephemeral Docker, synthetic credentials, mock APIs, throwaway PG + scratch FS, default-deny network, resource limits, guaranteed teardown — where FORGE builds and tests a capability draft before human review. No route to real Kernel infra. | Untrusted self-authored code must never build or run against real credentials or state |

## Rules

- Only `core`, `gateway`, and `diagnostics` (backend) use NestJS. `voice` /
  `vision` are minimal realtime runtimes depending only on `@jarvis/contracts`
  + a NATS client + local ML runtimes.
- No app under `apps/` except `gateway` may import a model provider SDK.
- No app except `core` writes an authoritative store.
- Adding a new app requires justifying it by **lifecycle or blast radius**, not
  by "it's a different domain" (ADR-0008).
