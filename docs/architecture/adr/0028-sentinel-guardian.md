# ADR-0028: Sentinel (defensive security intelligence) + the Guardian Response Playbook

Status: Accepted
Date: 2026-09-03
Deciders: Principal Security Architect (Claude), Principal (rhyslacy123)

## Context

`SECURITY_MODEL.md` and ADR-0019 give JARVIS a `GUARDIAN` operating mode but no
mechanism that *detects* an incident or *responds* to one. The HEPHAESTUS brief
asks for "defensive security intelligence" (Sentinel) and a Guardian behaviour
set, and is explicit: Sentinel must **not** become an offensive hacking
subsystem, and Guardian must **not** become unlimited root authority.

## Decision

### Sentinel = a deterministic detector service + a proposing specialist

**Sentinel Detector Service** — a Kernel-internal service, read-only with
respect to every store (like the Audit Manager). It consumes the `SECURITY`-
and `AUDIT`-class event streams, Health events, and the `telemetry` capability
output, and runs a fixed set of **deterministic detectors**:

| Detector | Fires on |
|---|---|
| `auth.bruteforce` | ≥ N `authenticate` failures for one identity / node in a window |
| `auth.new-node` | a `node.admitted` for a node id never seen, outside an operator-initiated admission |
| `auth.impossible-context` | successive auth contexts for one principal from incompatible `originNodeId` / `location` within a physically impossible interval |
| `perm.denial-storm` | ≥ N `capability.denied` for one actor / scope in a window |
| `cap.rate-anomaly` | invocation rate for a `(capability, action)` exceeds a rolling baseline by factor K |
| `cap.first-critical` | first-ever CRITICAL invocation for a principal, or first use of a newly-registered capability |
| `cred.mint-anomaly` | credential mints without a matching `capability.started` within T |
| `integrity.cert-expiry` | a node / TLS cert within D days of expiry |
| `integrity.backup-stale` | last successful backup older than the policy window |
| `integrity.event-gap` | a projection checkpoint gap or an out-of-order `global_seq` on a ledger subject |
| `proc.unexpected` | `telemetry` reports a process not on the node's expected set |
| `dep.vuln` | a `dependency.advisory` event matches an installed version |

Each detector emits `jarvis.security.alert.<severity>` (`SECURITY` retention)
with a structured `finding` — never free text as an instruction. Detectors are
pure functions over their event windows; thresholds are versioned config.

**`sentinel` specialist agent** (roster slot from `COGNITION_MODEL` §6 /
MIND §5) — correlates alerts into a narrative. It **proposes only**: an
`AnswerProposal` (an incident summary for the operator) or a
`PolicyRecommendationProposal` (e.g. "recommend DENY for `github` writes for
principal X pending review"). It holds no credentials, invokes nothing, and
its output is untrusted until validated.

**No offensive capability exists.** There is no scan / probe / exploit /
credential-spray / lateral-movement adapter. The Capability SDK and Registry
**reject** a manifest whose `sideEffects` contain active-intrusion verbs
(`exploit`, `bruteforce`, `port-scan`, `payload`, `c2`, …) — a denylist
enforced at registration and by `scripts/lint.mjs`.

### Guardian = the existing mode + a fixed, pre-authorised, restrict-only playbook

A `jarvis.security.alert.high` / `.critical` (or an explicit operator
command) drives the deterministic `ModeTransitionPolicy` (ADR-0019) into
`GUARDIAN`. Entering `GUARDIAN` triggers the **Guardian Response Playbook** — a
fixed table, each row an ordinary capability invocation **through the full
Executor pipeline** (so Guardian holds no special authority):

| Step | Action | Effect |
|---|---|---|
| G1 | `permission.tighten_all` | every active grant's `maxRiskWithoutLiveApproval` → `LOW`; `mayProceedWithoutLiveApproval` → false |
| G2 | `agency.suspend_autonomous_external` | `AUTONOMOUS`-mode invocations with an external `sideEffect` are queued, not run |
| G3 | (rule already live) | `base.guardian.lockdown` DENIES `riskClass >= HIGH`; `CRITICAL` denied by the engine hard cap |
| G4 | `audit.snapshot` | freeze the current audit partitions + dump in-flight `agency.invocations` rows to cold storage |
| G5 | `node.isolate(nodeId)` | **only if the triggering finding names a node**: revoke its node cert, drop its subscriptions and capability scopes |
| G6 | `notify.operator(all-surfaces)` | the incident summary + what the playbook did |

The playbook can **only narrow**. It cannot mint authority, widen a grant,
disable audit (G4 *adds* retention, never removes), register a capability, or
run anything not in this table. Every step emits `SECURITY`-class events.

Leaving `GUARDIAN` requires an explicit operator `security.cleared` command
(ADR-0019); the playbook's grant tightening is reversed by the operator
re-issuing grants, not automatically.

## Alternatives considered

- **Sentinel as a pure LLM agent watching logs.** Non-deterministic detection,
  spoofable, and it would need read access it should not have as an agent.
  Rejected — detection is deterministic; the agent only narrates.
- **Sentinel with a "respond" capability (block IP, kill process, quarantine
  file) it can invoke autonomously.** That is an offensive/active-defense
  subsystem with standing authority — exactly what the brief forbids.
  Rejected; Sentinel proposes, the operator (or the pre-authorised playbook)
  disposes.
- **Guardian as a privileged mode that can do anything "to save the system".**
  Becomes the root backdoor the constitution exists to prevent. Rejected —
  Guardian is restrict-only and runs through the same pipeline.
- **Playbook actions bypass the Executor "because it's an emergency".**
  Rejected — an emergency is when you least want an unaudited effect path.

## Benefits

- Detection is deterministic, testable, and cannot be jailbroken.
- Guardian's blast radius is bounded and auditable: it is six known,
  restrict-only invocations.
- No offensive capability can be registered — enforced, not promised.
- The operator is always notified and always holds the clear.

## Disadvantages

- Deterministic detectors miss novel attacks a heuristic model might catch
  (mitigated by the `sentinel` agent's advisory narrative and by tuning
  thresholds as config).
- Guardian's grant-tightening requires manual re-issue afterward (deliberate
  friction).

## Risks

- **Alert fatigue / false positives auto-tripping Guardian.** Mitigated: only
  `high`/`critical` alerts feed the mode transition; severity is a function of
  detector + corroboration count; entering Guardian always notifies and is
  itself reversible by the operator.
- **A detector threshold is set so loose it never fires.** Mitigated:
  thresholds are versioned config with unit tests that assert firing on known
  synthetic incident traces (part of the security test suite).

## Consequences

- New service `apps/core/src/kernel/sentinel/` (detector) — Kernel-internal,
  read-only.
- New capabilities: `permission` (tighten_all), `agency` (suspend/resume),
  `audit` (snapshot), `node` (isolate) — all `riskClass: HIGH`, all
  restrict-or-preserve only, all with `verify`.
- New events `jarvis.security.alert.*`, `jarvis.security.guardian.*`.
- New doc `SENTINEL_MODEL.md`; `SECURITY_MODEL.md` §10 and ADR-0019 gain
  cross-references.
- `scripts/lint.mjs` + Registry: active-intrusion verb denylist.

## Reversal difficulty

**Low.** Sentinel is a read-only detector service + an advisory agent; the
Guardian playbook is a data table of ordinary invocations. Removing the
concept means deleting the service, the table, and the `security.alert` events.
