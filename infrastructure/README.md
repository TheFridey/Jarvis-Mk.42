# infrastructure/

Deployment and data-plane configuration for MK.42: **workstation + local
server, Docker Compose** (`docs/architecture/LOCALITY_MODEL.md`, ADR-0014).

| Dir | Contents |
|---|---|
| `docker/` | Compose files: `local-server.compose.yml` (Kernel, gateway, Postgres, Redis, NATS, MinIO, OTel), `workstation.compose.yml` (voice, vision, telemetry collector). `.env.example`. |
| `postgres/` | Init scripts: schema + per-module role creation, `pgvector` extension, partitioning setup for `events` by class + time. Backup (WAL archiving + nightly base) config. |
| `redis/` | Config for ephemeral-only use: no RDB reliance, maxmemory + eviction policy, keyspace notifications for UI liveness. |
| `nats/` | JetStream config: `LEDGER` / `SIGNAL` / `DERIVED` streams, retention, durable consumer templates, DLQ subjects, per-process credentials (Kernel publish-ledger, perception publish-perception-only). |
| `observability/` | OTel Collector pipeline, and a local metrics/traces/logs backend for diagnostics. |

## Principles enforced here

- Cloud runs **no** JARVIS authoritative component — only model APIs reached
  from the gateway.
- Postgres is the only backed-up datastore (plus object storage);
  Redis is never backed up.
- Every process gets a **scoped** credential: the Kernel holds DB + NATS
  ledger-publish; the gateway holds provider keys; adapters hold their own
  resource creds; perception holds NATS `jarvis.perception.>` publish only.
- Workstation ↔ local server is mTLS on the LAN. No `relay` in MK.42.
