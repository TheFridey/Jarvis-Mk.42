# ORACLE waiting counter

## Cause

Two independent defects, both in the projection rather than the queue:

1. `desktop-gateway.ts` marked a job active when `state in ('RUNNING','WAITING')` and the lease was
   live, with no check that the job had finished. A job that completed without transitioning its state
   presented as active indefinitely.
2. `agent-field-policy.ts` reported `jobCount` as every job the agent had ever run, and
   `presence-mode.tsx` rendered that number next to the state, so the readout grew by one per
   conversation regardless of work outstanding.

Database truth, metadata only: `cognition.agent_jobs` holds 77 rows for `agents.oracle` - 55 COMPLETE,
22 FAILED, zero in any active state. Nothing was ever waiting.

## Correction

- `activity_confirmed` now requires `finished_at is null`.
- An agent's state is derived only from outstanding jobs, so finished work cannot lend it a waiting
  state.
- `activeJobCount` is what the interface shows; `jobCount` (history) remains available and is no longer
  presented as a queue.

Verified by test: three jobs for one agent (two finished, one running) yield `jobCount: 3`,
`activeJobCount: 1`, state WORKING.

## Remaining

No remediation of historical rows is proposed: they are accurate history. If the readout should say
"COMPLETE - 0 JOBS" rather than "COMPLETE", that is a display preference, not a defect.
