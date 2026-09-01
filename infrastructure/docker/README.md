# infrastructure/docker

Docker Compose is the MK.42 orchestrator (ADR-0014). Two compose files, one per
node.

## `local-server.compose.yml` (the always-on server)

| Service | Image basis | Notes |
|---|---|---|
| `core` | `apps/core` | The Kernel. Depends on postgres, redis, nats, minio. |
| `gateway` | `apps/gateway` | Model Gateway. Holds provider keys via `env_file`. Only egress to cloud. |
| `postgres` | `postgres` + `pgvector` | Authoritative store. Named volume. WAL archiving to `minio`. |
| `redis` | `redis` | Ephemeral only. `--save ""` (no RDB reliance). maxmemory + `allkeys-lru`. |
| `nats` | `nats` (JetStream on) | Transport. File storage volume for JetStream. |
| `minio` | `minio` | Object storage. Buckets: `captures`, `artifacts`, `exports`, `memory-cold`, `pg-wal`. |
| `otel-collector` | `otel/opentelemetry-collector` | Telemetry sink. |

## `workstation.compose.yml`

| Service | Notes |
|---|---|
| `voice` | `apps/voice`. Host audio device access. Publishes to `nats` on the server. |
| `vision` | `apps/vision`. Host camera + optional GPU passthrough. |
| `telemetry-agent` | Ships workstation OTel to the server collector. |

The Tauri `desktop` shell and `diagnostics` run natively on the workstation,
not in Compose.

## Rules

- No service runs as root beyond what its job needs.
- Each service gets only the env/secrets it needs (`env_file` per service,
  never a shared blob).
- `postgres` and `minio` volumes are the backup targets; `redis` and `nats`
  volumes are disposable.
