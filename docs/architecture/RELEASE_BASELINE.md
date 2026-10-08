# Release baseline

Baseline scope: latest main `19501ce7e758599185ce408402f846a5dffa07c6` plus the
focused speech-boundary and documentation correction in this PR. This is a
code/infrastructure qualification, not a production or hardware certificate.
The PR's **MK42 Quality Gates / quality** check is the authoritative result
for its actual resulting commit. Historical counts in other reports do not
certify this change.

## Implemented technologies and ownership

| Area | Implementation and practical limit |
| --- | --- |
| Workspace | pnpm 9.15.9; Node >=22; TypeScript 5.6; ESM; strict compiler checks and custom structural lint, not an ESLint certification |
| Kernel | Node process, manually injected services, `buildKernel` composition root and `node:http` ingress; no NestJS runtime |
| Persistence | PostgreSQL/pgvector, Drizzle schema/typed access and SQL migrations; ledger/outbox and projections are authoritative |
| Event fabric | NATS JetStream with transactional outbox/recovery; Redis is reconstructible, not an authority store |
| Cognition | Separate Model Gateway, provider adapters, bounded worker processes, task/privacy/locality/budget routing; fixtures do not prove provider quality |
| Speech | LiveKit/WebRTC agent; Windows System.Speech local path; consent-selected cloud speech through authenticated Gateway; bounded WAV recognition and mono int16 16 kHz replies |
| Experience | Next.js 15 / React 19, Three.js/Fiber, Tauri 2 shell; desktop gate builds Next export, not a native Tauri installer |
| Perception | Separate voice/vision implementations; MediaPipe-derived observations and local Windows driver; physical accuracy remains unqualified |
| Authority | Policy, Permission, Approval, Executor, Credential Broker and verification; agents propose and projections render derived state |
| Observability | OpenTelemetry SDK/exporter and trace propagation, optional Compose monitoring stack; configured instrumentation is not proof of complete production coverage |
| Other nodes | Android companion and display runtime exist; separate hardware, network and native builds are outside this CI workflow |

Real libraries are the workspace directories containing `package.json` and
source. README-only `packages/*` and `apps/diagnostics` / `apps/relay` seams are
not independently deployable applications. Current diagnostics HTTP lives in
Core. Kernel services live under `apps/core/src/kernel`, not the aspirational
per-component package layout. ADR-0040 records the framework decision.

## Fixed defects

1. Core RTC speech called provider APIs and read a provider key outside the
   Model Gateway, failing mandatory architecture fitness. Provider requests,
   models and PCM conversion now live in the Gateway adapter; Core uses the
   shared speech contract and authenticated HTTP transport.
2. RTC cloud admission required a provider credential in the Kernel process.
   Admission now remains provider-neutral; unavailable provider configuration
   fails closed at the Gateway. Local speech remains the default and only
   explicit cloud session selection sends audio to that boundary.
3. Odd-length provider PCM could reach int16 reads without sample alignment
   validation. The adapter rejects incomplete samples.
4. Current architecture/workspace documentation described NestJS modules and
   obsolete gate execution as implemented. Current descriptions are corrected;
   historical ADRs and test/operational reports are preserved with status notes.

No architecture assertions were removed or relaxed. No Forge Cosmos visuals,
layout, branding, palettes, animation, CSS or model-specific visual state changed.

## Mandatory verification

Run `pnpm install --frozen-lockfile`, ensure Docker is available, then
`pnpm verify:full`. The unchanged `.github/workflows/quality.yml` executes the
following on Ubuntu/Node 22 for every push/PR to main; integration concurrency
is two workers in CI and defaults to one on Windows.

| Command | Evidence required |
| --- | --- |
| `pnpm typecheck` | Strict TypeScript passes |
| `pnpm lint` | TypeScript and structural/capability lint pass |
| `pnpm test` | Unit suites, including speech adapter and real local HTTP boundary regressions |
| `pnpm test:integration` | Real disposable PostgreSQL/NATS and Kernel paths; fresh JSON report and zero skipped tests |
| `pnpm test:contract` | Shared protocol compatibility suites |
| `pnpm test:security` | Release and agency security suites |
| `pnpm fitness` | Architecture fitness and boundary sweep, including provider wire/API confinement |
| `pnpm test:chaos` | Mandatory Docker-backed infrastructure and foundation failure suites |
| `pnpm backup:drill` | Real pg_dump/pg_restore, restored invariants and Kernel boot |
| `pnpm build:desktop` | Next production desktop export; generated output is not source evidence |

Speech regressions use controlled provider responses and actual local HTTP
transport. They establish authentication, consent enforcement, input validation,
cancellation propagation, error redaction and PCM conversion; they do not call
a paid provider or prove human speech quality. Integration/provider fixture
answers remain fixtures. `pnpm verify` alone is insufficient for a release.
The infrastructure chaos suite verifies host fault-injection mechanisms;
Kernel recovery evidence comes from the separate integration tests. Those
claims must not be conflated.

## Scenarios requiring separate live verification

- Real provider ASR/TTS through the new Gateway on this exact release, with
  provisioned credentials, chosen model availability, quotas and outage behavior.
- Physical microphone recognition, audible speaker output, acoustic echo
  cancellation, barge-in, VAD thresholds and measured interactive latency.
- Windows installed language/voice combinations, camera/hand tracking/Air Touch,
  multi-monitor continuity and native Tauri rendering/packaging.
- Android microphone/speaker/Bluetooth/KeyChain, battery/background behavior,
  tunnel certificate/hostname and separate wall/workstation continuity.
- Live business accounts, OAuth refresh/revocation, production telemetry and
  engineering repair-to-PR workflows with real models and user approvals.
- Production/LAN deployment, TLS/secrets provisioning, real-data backup restore,
  capacity, long-running availability and stolen LiveKit-token limitations.

Passing synthetic speech or disposable infrastructure does not close these
items. No production deployment is performed by this baseline PR.
