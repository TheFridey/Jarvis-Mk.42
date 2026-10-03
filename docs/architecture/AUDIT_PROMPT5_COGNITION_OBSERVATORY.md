# Prompt 5 Cognition Observatory implementation evidence

Date: 2026-10-01. Baseline: local `main`, `07dcdb2` (RC1.2 alignment and hardening).
This audit describes working-tree changes, not a deployed or tagged release.

## Architecture and changes

Existing Gateway/Registry, Agent Runtime, Cognition Orchestrator, `cognition.runs`,
Event Manager, Experience Projection and desktop transport are extended in place.
The Gateway reports actual attempt/fallback transitions over its authenticated
SSE response. The Kernel records observations and emits existing canonical
lifecycle events. Desktop remains read-only. No authority component, world model,
memory store, workflow engine or product dependency was introduced.

Forward-only migration `0014_cognition_observability.sql` extends Kernel-owned
cognition runs. Typed routing/usage contracts preserve unknown token counts and
endpoint health; provider response bodies are redacted at the Gateway boundary.
Observation/persistence failures do not trigger provider fallback.

The Model Rail displays candidate reasons, selected/fallback routes, observed
health/circuit state and separate context-unit/token/latency/cost dimensions.
It includes an inspectable bounded route diagram, reduced-motion behavior and
explicit stale state. Responsive disclosure keeps the rail available on compact
screens. No provider quota, GPU, VRAM or queue telemetry is fabricated.

## Verification

- Final fresh `pnpm verify`: PASS; typecheck, structural lint and 56 unit files / 250 tests.
- Explicit desktop TypeScript check: PASS.
- Focused Gateway/client tests: 3 files / 17 tests passed.
- Full `pnpm verify:full`: PASS (exit 0). Integration 15 files / 79 tests;
  contract 4 files / 16 tests; security 3 files / 30 tests; fitness 2 files / 17
  tests; chaos 2 files / 13 tests. Chaos includes 10 deterministic failure-logic
  tests and 3 host-level fault-injection mechanism tests, not 13 live JARVIS
  infrastructure tests.
- Backup/restore: PASS; real `pg_dump` artifact restored, Kernel booted, durable
  completed invocation not re-executed. Migration 0014 was included.
- After final desktop-only stale-Core safeguards, `pnpm verify`, contract,
  security and fitness were rerun successfully. `pnpm build:desktop` also PASS:
  route `/` 58.9 kB, first-load JavaScript 162 kB. Next.js skips its ESLint step
  by existing configuration; the separate repository structural lint passed.
- Playwright local development page: loaded after cold compilation; no framework
  error overlay; compact rail disclosure and 1600x1000 layout checked, no horizontal
  overflow. Commands stayed disabled with Kernel absent; rail explicitly reported
  stale/unconfirmed data. Expected connection-refused errors were observed for
  the absent Kernel. Three.js also emitted a Clock deprecation warning from the
  existing renderer stack. This is not an authenticated live-provider end-to-end test.

## Remaining boundaries

Status is PARTIAL. Live provider calls/billing, first-token streaming, quota APIs,
local queue/GPU/VRAM telemetry and native Tauri/device behavior are unverified.
Session-wide aggregation and a standby catalogue outside a request need explicit
session/catalogue semantics; they are not approximated from a bounded recent-run
list. Core-to-resource spatial choreography is deferred; current route diagram
geometry is render-only and does not replace the Semantic Scene.

No deployment, hardware performance certification or product release is claimed.
Incidental tracked `apps/desktop/out` build changes were restored to their baseline
after verification, matching the repository's existing audit convention. Source
changes and the new migration remain; rebuild before packaging the desktop.
