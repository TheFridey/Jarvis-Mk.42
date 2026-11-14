# LIVE ACCEPTANCE - final correction

Baseline `bb21aaf`, superseded by this pass. Owner records, approvals, classifications and grants
untouched. No paid provider call, no queue executed, no container destroyed.

## What was actually wrong

Three of the reported defects were worse than reported, and one of them made the retry protection
inert.

| # | Reported | Actual |
|---|---|---|
| 1 | CompanionService may omit `memoryBearing` | It did. Nothing in production ever set it - the Gateway guard armed on a flag only tests supplied. |
| 2 | Gateway refuses fallback for protected requests | It never read the header. `request.disclosure` was only ever populated in-process by tests. |
| 3 | AgentRuntime repairs malformed output with a second inference | True, and untested for protected requests. |
| 4 | 422 on a deep reflection | Output ceiling was 2000 tokens; a deep personalised answer hit it, reported `length`, became INVALID_RESPONSE. |
| 5 | Follow-up repeated the same facts | The selection had no notion of what the conversation already knew. |
| 6 | Personalised explanation classified as general knowledge | True. |
| 7 | Named entity read as profile recall | True: "everything you know" matched before any entity check. |
| 8 | ORACLE counter grows | The projection counted every job ever run and left finished rows able to present as active. |

## Corrections

- `companion-service.ts`: the Kernel classifies its own output. `carriesPersonalContext()` is true when
  a verified memory block is present or the turn carries conversation history, because a previous turn
  may already contain retrieved memory and revocation cannot un-send it. Public-web analysis is never
  personal. The flag is set by the Kernel, never by the caller or the model.
- `gateway/main.ts`: the disclosure header is read for the first time, and it fails safe - only an
  explicit `0` permits fallback; a missing or unrecognised marker is treated as personal.
- `agent-runtime.ts`: a protected request never enters the format-repair pass. It returns a classified
  `INVALID_RESPONSE` naming the refusal instead of replaying the prompt.
- `cognition-orchestrator.ts`: hard output ceiling 2000 to 8192; `outputAllowanceFor(intent)` decides
  per request (512 for a greeting, 6144 for a deep session, 1536 for an explanation).
- `http-server.ts`: classified inference failures are logged before the response leaves - status, code,
  provider, retryable, stage only. No body, no prompt, no statement, no exception text.
- `scene-client.ts`: 422 is no longer a bare `KERNEL_COMMAND_REJECTED_422`, and 409 cancellation is
  distinguished from a state-version conflict, which would have resubmitted.
- `retrieval-intent.ts`: `PERSONALISED_EXPLANATION`; entity precedence for "everything about X";
  per-intent output allowances.
- `personal-memory.ts` plus migration `0021`: records a turn has already received are excluded, so a
  follow-up expands instead of repeating. Ids only, never statements.
- `agent-field-policy.ts`, `presence-mode.tsx`, `desktop-gateway.ts`: outstanding work is counted
  separately from history, and a job with `finished_at` set can never report as active.

## Verification

- `disclosure-classification.test.ts` - 4 tests pinning the classification policy.
- `agent-runtime-disclosure.test.ts` - protected: one inference and a truthful refusal; unprotected:
  exactly one repair.
- `retrieval-correction.test.ts` - 9 tests: entity precedence, learning intent, allowances, additive
  follow-up, exhaustion honesty.
- `agent-field-policy.test.ts` - history counted, queue counted separately.
- Full suite 897 passed / 6 skipped / 0 failed, 148 files, exit 0. Lint clean, fitness 17/17.

## Status

VERIFIED: disclosure classification and propagation code path, format-repair closure, output
allowances, diagnostics, frontend error classification, retrieval corrections, ORACLE count.
PARTIAL: browser re-run (blocked), conversation-history proof beyond the classification rule.

## Honest limitations

- The Gateway trust boundary remains: a caller holding the Gateway token can send `0`. Fail-safe now
  covers omission, not a deliberate lie. Closing that needs per-request authorisation at the Gateway.
- Record-level revocation still cannot remove personal facts from turns already stored in a
  conversation; the protection ensures they are not retransmitted, not that they are forgotten.
