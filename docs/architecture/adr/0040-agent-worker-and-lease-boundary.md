# ADR 0040 — Agent Runtime worker and lease boundary

Status: implemented; required local gates green on 2026-10-02. See the
Prompt 6 audit for exact results and unproven deployment/hardware boundaries.

The frozen Agent Runtime (component 12) supervises workers. No new Kernel
authority, workflow engine, event publisher, or memory/world store is added.

PostgreSQL owns job history and fenced leases. Redis is not required to recover
these records. Owner plus monotonically increasing attempt fence mutations;
database time controls expiry. Global admission is serialized by an advisory
transaction lock: four concurrent leases, 64 queued/active jobs, four children
per parent, three levels. Workers cannot request child jobs.

A fixed Node process inherits only NODE_ENV, has a bounded heap, and permission
grants to read only its runtime file. The parent mediates the original immutable
Model Gateway request; IPC allows model request, heartbeat, and result only.
No database, NATS, provider, capability or Gateway credentials cross IPC.
This is process isolation and defense in depth, NOT hostile-code container
isolation. Node 22 permission controls do not provide a network firewall.
Arbitrary agent code/plugins are not supported by this worker.

AgentJobTransitioned / jarvis.cognition.agent.job.transitioned is version 1,
owned by Agent Runtime, AUDIT retention, INTERNAL privacy. Its schema requires
job/agent/state/attempt. Envelope principal, causation, correlation and system
provenance are supplied through Event Manager. State and event/outbox append
share a transaction; derived listeners are notified explicitly after commit.
Heartbeat writes do not create canonical events. Experience subscribers consume
the existing cognition channel idempotently, not a UI-only authority.

Only pre-inference expired leases may be recovered, with at most two attempts.
Unknown inference outcomes become BLOCKED rather than incur duplicate model
cost. Reaping uses the existing Scheduler health routine. Do not kill a PID
loaded from PostgreSQL: PID reuse makes that unsafe; kill owned process handles.

Validated proposals still pass Cognition → Agency Ingress → existing policy,
permission, approval and Executor boundaries. Job COMPLETE means cognitive
output, never proof that a proposed capability executed or verified.

Admitted queued jobs drain on committed transitions. The existing Scheduler
lease sweep also wakes waiters for cross-process/recovery liveness. No new
workflow authority or tight polling loop is introduced. Cancellation is a
session-scoped desktop.write command, principal-bound and version-guarded.

Restart recovery requires trusted resubmission of the original purpose-bound
request. Context is freshly compiled and privacy gates rerun; prompts are not
persisted as another memory store. Completed validated output can be reused
without another model call. Unknown inference outcomes remain BLOCKED.

Architectural conflict found by replay tests: ordinary Agency submission can
resume an awaiting approval. Cognitive replay must not resume or deny it.
Agency submitOnce observes the sealed existing effect instead; explicit approved
resumption retains the existing pipeline. Proposal IDs are namespaced by Kernel
job identity. Model claims cannot override parent-mediated response or compiled
context taint; method/producer are stamped by Runtime. Policy is unchanged.

Experience distinguishes durable cognitive state from linked Executor state:
WAITING_APPROVAL/VERIFYING are derived, not new worker authorities. Active
models/agents require a current database-time lease; stale running rows do not
animate activity. Evidence sampling and omitted response bodies are explicitly
marked to keep transport bounded without changing durable history.

Deferred: OS/container hostile-code sandbox, arbitrary plugin execution,
autonomous reconstruction of unstored prompts, and native/browser end-to-end
certification. None is claimed by process-level isolation or source tests.
