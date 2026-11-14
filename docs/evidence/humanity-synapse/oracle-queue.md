# ORACLE waiting counter

## Finding (metadata only, live database)

```
select state, count(*) from cognition.agent_jobs group by 1;
COMPLETE 55
FAILED   22
```

**Zero rows are queued, leased, running or waiting.** All 77 jobs belong to `agents.oracle`, which
matches the counter the owner watched move from 69 to 75.

## Conclusion

The counter is a **presentation defect**: the interface presents the agent's historical job
population as work waiting to be done. Nothing is pending, no worker is idle because of it, and it
cannot consume inference — the rows are finished (55) or failed (22).

The practical consequence is that the readout grows over time, because it counts history.

## Not done

I did not locate and correct the aggregation. The defect is in how the desktop projection derives
the oracle's state from its jobs: a completed job should not present as WAITING. The narrow fix is
to count only genuinely active states (`QUEUED`, `LEASED`, `RUNNING`) and to show a historical total
separately, if at all.

## Owner action

None for correctness or privacy. The readout is noise until the projection is corrected.
