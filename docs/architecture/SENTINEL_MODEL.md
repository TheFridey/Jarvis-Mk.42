# Sentinel Model

Defensive security intelligence. Sentinel **detects** and **narrates**; it does
not attack and it does not act with standing authority. Subordinate to
[`PRINCIPLES.md`](PRINCIPLES.md) and [`SECURITY_MODEL.md`](SECURITY_MODEL.md).
As-designed by [`adr/0028-sentinel-guardian.md`](adr/0028-sentinel-guardian.md).

---

## 1. Stance

- Sentinel is **defensive only**. There is no scan / probe / exploit /
  credential-spray / lateral-movement capability, and none can be registered —
  the active-intrusion verb denylist (`exploit`, `bruteforce`, `port-scan`,
  `payload`, `c2`, `keylog`, `exfiltrate`, …) is enforced at three points: the
  `defineCapability` build, Capability Registry registration, and
  `scripts/lint.mjs`.
- Detection is **deterministic**. Detectors are pure functions over event
  windows; a jailbroken model cannot change what fires.
- Response with authority is **the Guardian playbook only** (restrict-only,
  through the Executor, operator-reversible). Sentinel itself invokes nothing.

## 2. The detector service

A Kernel-internal service (`apps/core/src/kernel/sentinel/`), read-only with
respect to every store — it consumes events and Health signals, and owns only
its detector config and the `agency.security_alerts` projection.

Inputs: the `SECURITY`- and `AUDIT`-class event streams, `jarvis.health.*`,
and the `capabilities.telemetry` output.

| Detector | Fires when |
|---|---|
| `auth.bruteforce` | ≥ N `authenticate` failures for one identity/node in a window |
| `auth.new-node` | `node.admitted` for an unseen node id outside an operator-initiated admission |
| `auth.impossible-context` | successive auth contexts for one principal from incompatible `originNodeId`/`location` within a physically impossible interval |
| `perm.denial-storm` | ≥ N `capability.denied` for one actor/scope in a window |
| `cap.rate-anomaly` | invocation rate for a `(capability, action)` exceeds a rolling baseline by factor K |
| `cap.first-critical` | first-ever CRITICAL invocation for a principal, or first use of a newly-registered / probationary capability |
| `cred.mint-anomaly` | credential mints without a matching `capability.started` within T |
| `integrity.cert-expiry` | a node / TLS cert within D days of expiry |
| `integrity.backup-stale` | last successful backup older than the policy window |
| `integrity.event-gap` | a projection checkpoint gap or an out-of-order `global_seq` on a ledger subject |
| `proc.unexpected` | `telemetry` reports a process not on the node's expected set |
| `dep.vuln` | a `dependency.advisory` event matches an installed version |

Each fires `jarvis.security.alert.<low|elevated|high|critical>` (`SECURITY`
retention) with a structured `finding` — never free text treated as an
instruction. Severity is a function of the detector plus corroboration count.
Thresholds are **versioned config** with tests that assert firing on known
synthetic incident traces.

## 3. The `sentinel` specialist agent

Roster slot from `COGNITION_MODEL.md` §6 / the MIND spec §5.

- `proposalScope.kinds = ['answer', 'policy_recommendation']`,
  `proposalScope.capabilities = []`.
- `allowedTools = ['audit_query', 'atlas_query']` (read-only, mediated).
- It correlates alerts into an operator-facing incident narrative and may
  emit a `PolicyRecommendationProposal` (e.g. "recommend DENY for `github`
  writes for principal X pending review"). That recommendation is **one typed
  input** to a policy rule and can only ever produce `DENY` (L21).
- It holds no credentials, invokes nothing, and its output is untrusted until
  the Validator passes it.

## 4. Alert → mode

Only `high` / `critical` alerts (with corroboration) are eligible to feed the
deterministic `ModeTransitionPolicy` (ADR-0019) toward `GUARDIAN`. The
transition still emits `jarvis.mode.changed` (`SECURITY` when entering
GUARDIAN) and notifies the operator. `low` / `elevated` alerts are recorded and
surfaced; they do not change mode.

## 5. Guardian Response Playbook

Entering `GUARDIAN` runs six steps, each an ordinary Executor invocation of a
restrict-or-preserve-only capability (so Guardian holds no special authority):

| Step | Capability (riskClass) | Effect |
|---|---|---|
| G1 | `permission.tighten_all` (HIGH) | every active grant → `maxRiskWithoutLiveApproval = LOW`, `mayProceedWithoutLiveApproval = false` |
| G2 | `agency.suspend_autonomous_external` (HIGH) | `AUTONOMOUS`-mode invocations with an external `sideEffect` are queued, not run |
| G3 | (policy rule `base.guardian.lockdown`, already live) | DENY `riskClass >= HIGH`; the engine hard cap denies `CRITICAL` |
| G4 | `audit.snapshot` (HIGH) | freeze current audit partitions + dump in-flight `agency.invocations` to cold storage (adds retention, never removes) |
| G5 | `node.isolate(nodeId)` (HIGH) | **only if the finding names a node**: revoke its node cert, drop its subscriptions and capability scopes |
| G6 | `notify.operator(all-surfaces)` (LOW) | the incident summary + what the playbook did |

Guardian **cannot** mint authority, widen a grant, register a capability,
remove audit retention, or run anything not in this table. Exit requires an
explicit operator `security.cleared` command; the grant tightening is undone by
the operator re-issuing grants, not automatically.

## 6. What Sentinel must never do

- Run an offensive / active-defense action (block, kill, quarantine, scan,
  probe) autonomously or otherwise — it proposes; the operator or the
  pre-authorised playbook disposes.
- Hold a credential or a capability handle.
- Change a policy decision (it may only feed a `DENY`-producing rule input).
- Suppress or delete an event, or reduce audit retention.
- Become the path by which authority is exercised "in an emergency".
