# Prompt 6 — Agent Runtime / Observatory evidence

Status: IMPLEMENTED; full required local verification GREEN on 2026-10-02.
This is working-tree evidence, not deployed/native/hardware release certification.
Scope inspected against main
07dcdb2, the frozen constitution, component manifests, migration history,
existing Cognition/Agency boundaries and `.github/workflows/quality.yml`.
Previous Prompt 5 changes in the worktree were preserved.

Implemented in the existing Runtime: migration 0015 job history, PostgreSQL
clock-based fenced leases, bounded admission/fan-out, heartbeat and expiry
reaping, fixed credentialless process workers, mediated inference, hard wall
abort, context/cost bounds, proposal/evidence validation and durable output.
Eleven specialist manifests are loaded rather than silently reducing the
roster to Oracle/Scout/Forge. No new authority component was introduced.

Event transitions use Event Manager and transactional outbox; notifications
for these writes happen explicitly after commit. Experience's existing
cognition stream includes typed job records. The accessible DOM Observatory
shows group membership, specialist/model/proposal relationships, recorded
stage, elapsed-at-projection, budgets, objective and parent references.
Disconnected data is labeled stale; groups and roster entries do not imply
activity. Next.js/React skill review kept the view serializable and read-only.

Admitted queues drain on commit notifications, with recovery liveness through
the existing Scheduler lease sweep. Cancellation is principal-bound behind
session desktop.write and version guards. Stop drains owned workers before
database shutdown. Restart resubmission recompiles context and reruns privacy
gates. Completed validated output is reused without another model call;
unknown inference outcomes block rather than incur duplicate cost.

Replay tests found an approval-resumption conflict: cognitive replay now uses
Agency submitOnce, observing existing effects without resuming approval or
duplicating execution. Explicit approval resumption retains the existing path.
Kernel job-namespaced proposal IDs prevent cross-job model identity collisions.
Proposals cannot override parent-adapter or compiled-context taint; existing
Policy/Permission/Approval/Executor gates are unchanged.

WAITING_APPROVAL/VERIFYING derive from Executor records separately from cognitive
COMPLETE. Active workers/models require current database-time lease evidence;
stale running rows are not live activity. Evidence samples and omitted response
bodies are explicitly marked to keep transport bounded without changing history.

Important limits:

- Node process permission controls are not a hostile-code sandbox or network
  firewall; no arbitrary plugin execution is enabled.
- Queue admission and drain are bounded. Pre-inference recovery requires a
  trusted caller to reclaim
  the original bound request; compiled context is not stored as a second memory.
- Authenticated cancellation applies to cognitive jobs, not already dispatched
  effects; cancellation is not a rollback or execution-revocation claim.
- All eleven manifests are registered and the typed cognition command supports
  the full roster. Orchestration groups are presentation metadata, not authorities.
- Cost enforcement uses observed Gateway estimates, not unsupported guarantees
  of provider billing. Autonomous reconstruction of unstored prompts is deferred.
- No native Tauri, live provider, hostile-code containment, or live graph
  end-to-end certification was performed for these additions. Offline browser
  rendering and disconnected-state honesty were checked separately below.

## Final verification

`pnpm verify:full` completed with exit 0 on the final source, on local main
base 07dcdb2 with uncommitted Prompt 5/6 changes. No commit, push or deployment
was performed. Integration ran serially against disposable real infrastructure.

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS |
| Unit | 58 files / 271 tests PASS |
| Integration | 16 files / 87 tests PASS; 1495.28 seconds |
| Contract | 4 files / 16 tests PASS |
| Security | 3 files / 30 tests PASS |
| Architecture fitness | 2 files / 17 tests PASS |
| Chaos | 2 files / 13 tests PASS |
| Backup/restore | PASS: pg_dump restored, Kernel booted, completed invocation not re-executed |
| Desktop production build | PASS: root 60.2 kB; first-load JS 163 kB |

The final integration run includes eight agent-job tests: killed real worker,
fenced recovery/store reconstruction, unknown-outcome blocking, bounded
fan-out/principal binding, wall timeout/event/outbox, queue/concurrency,
cancellation and real Kernel stop/start recovery without duplicate inference.
Kernel lifecycle's nine tests include cancellation HTTP scope, principal and
revocation rejection. Cognition's two tests include durable output replay
without duplicate inference or disturbing approval, then verified execution.
The real JetStream ownership audit includes the new job event and passes.

Earlier attempts failed due to Docker availability/readiness and Redis restart
errors; those were not green evidence. Targeted replay also exposed universal
untrusted tagging denying the trusted fixture path. Parent-adapter/context taint
now controls that boundary, with a regression test and unchanged policy rules.
The final complete rerun supersedes those attempts; tests were not weakened.

## Browser boundary

- Fresh offline browser check on loopback Next.js dev server: page rendered,
  no page errors reported, Observatory expanded with disconnected/stale labeling,
  zero simulated jobs, and Kernel commands disabled. Screenshot inspected.
  Initial cold compilation/CLI daemon attempts timed out; a single-session
  command batch passed. Browser and owned dev server were closed afterwards.
  This does not certify live stream-to-graph behavior or workstation GPU speed.

Tracked generated desktop exports were clean before verification and restored
afterwards; source changes remain. `git diff --check` reported no whitespace
errors. ADR 0040 records the authority/recovery decision. Native, provider and
live stream-to-graph certification remain unproven as stated above.
