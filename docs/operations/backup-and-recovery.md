# PostgreSQL backup and disaster recovery

Status: IMPLEMENTED for the CI restore drill; production scheduling is PLANNED.

`pnpm backup:drill` is a mandatory destructive test against two disposable PostgreSQL containers. It migrates and seeds Kernel state, ATLAS, MNEMOSYNE, objectives, an already-completed durable invocation, and policy data; creates a custom-format `pg_dump` artifact outside the live container; destroys the source database; restores into a fresh database with `pg_restore`; boots the Kernel against it; and checks the durable invariants. Missing Docker, failed dump/restore, or failed Kernel boot is a red gate, never a skip.

Production must use encrypted, versioned off-host object storage, daily logical backups plus continuous WAL archiving, retention monitoring, restricted restore credentials, and a scheduled restore into an isolated environment. Redis is intentionally excluded because it is ephemeral. Secrets are backed up through the operator's separate secret-management recovery process and must never be placed in the database artifact.

The CI drill proves logical backup recoverability and cold boot. It does not claim that production WAL archiving, object-store replication, encryption keys, retention alarms, or recovery-time objectives are deployed; those remain operational rollout work.
