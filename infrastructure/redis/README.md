# infrastructure/redis

Redis holds **Ephemeral Runtime State only** (ADR-0004). It is never
authoritative and is never backed up.

## Config stance

- `--save ""` and `appendonly no` — we do not rely on persistence. A restart
  starting empty is a supported, tested path (`FAILURE_MODEL.md` §Redis).
- `maxmemory` set; `maxmemory-policy allkeys-lru` — caches evict cleanly.
- Keyspace notifications on for UI-liveness pub/sub.
- Bound to the local-server network only; AUTH password from `env_file`.

## Key namespaces (all reconstructible)

| Prefix | Holds | Rebuilt from |
|---|---|---|
| `sess:live:*` | session liveness | live socket reconnections |
| `node:live:*` | node heartbeat/RTT | node re-registration |
| `presence:*` | current presence | recomputed from sessions + observations |
| `auth:tok:*` | authority tokens (TTL) | re-acquired; issuance events in `events` |
| `lease:*` | locks / leases | re-acquired by holders at next checkpoint |
| `rate:*` | rate-limit counters | reset (fail-safe conservative limits meanwhile) |
| `notif:unread:*` | unread counts | recomputed from `projections.notifications` |
| `health:*` | current health | re-probed by Health Manager |

If a value here matters after a reboot, it is in the **wrong place** — it
belongs in PostgreSQL.
