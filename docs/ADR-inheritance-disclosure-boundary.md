# ADR: the disclosure boundary

Status: accepted. Applies to memory reaching a model provider.

## Context

Personal memory is selected per turn and can leave the machine on a cloud-authorised turn. The
question this ADR answers is: *at what point does selection stop being revocable, and what does the
system promise?*

## Decision

Eligibility is evaluated twice: once during selection, and again immediately before
`runtime.invoke` (`verifyBeforeDispatch` for the grant, a fresh re-read and re-selection for the
records). Approval, consent, classification and revocation are all honoured at that second check.

After that check the request is serialised and written to a socket. **No transaction is held
across the provider call.** Holding one would buy the appearance of atomicity rather than the fact,
and would tie database availability to provider latency.

## Guarantees, ordered

| Moment | Guarantee |
|---|---|
| Before selection | A revoked or unapproved record is never considered. |
| After selection, before dispatch | Removed by re-read; proven by test (`revoked-after-selection`). |
| Between final check and socket write | **Best effort only.** Window is microseconds to low milliseconds, single process, no locks. |
| During transmission | **No guarantee.** |
| After transmission | Nothing can be recalled. Revocation governs future context only. |
| Retry | Not applicable in the Kernel client (no retries); the gateway retries without memory visibility, so a retry cannot re-add memory — it can only resend a body already formed. |

## Consequences

- The system can honestly say: *a revocation stops the next transmission, not the current one.*
- A stronger guarantee would require either a token-bound dispatch key issued inside the same
  transaction as the memory read, or an outbound proxy that holds the body until a final check —
  both larger than the value they add for a single-user desktop assistant.
- Operators are told, in the consent guide, that withdrawal is immediate for future turns and
  cannot recall what already left.

## Alternatives considered

1. **Serialised disclosure log with post-hoc audit** — adds accountability without prevention; kept
   as a future option (`dispatch_receipts` table), not implemented.
2. **Two-phase commit with the provider** — the provider has no such primitive.
3. **Hold the transaction open across the HTTP call** — rejected: availability coupling and false
   assurance.


## Amendment - trusted classification and every retransmission path

The original decision said the Kernel marks memory-bearing requests and the Gateway refuses to fall
back for them. Inspection showed both halves were only true in tests: nothing set `memoryBearing`, and
the Gateway never read the header.

### Decision

1. **The Kernel classifies its own output.** `carriesPersonalContext()` returns true when a verified
   memory block is present or when the turn carries conversation history. History counts because a
   previous turn may already contain retrieved memory; revocation cannot un-send it. Nothing the model,
   the browser or a direct caller supplies can lower this classification.
2. **The Gateway fails safe.** Only an explicit `x-jarvis-memory-disclosure: 0`, emitted by the Kernel
   for a turn it classified as non-personal, permits candidate fallback. A missing or unrecognised
   marker is treated as personal. The cost of a refused fallback is one honest error; the cost of a
   wrong fallback is a second disclosure nobody consented to.
3. **Every autonomous retransmission path is closed for protected requests**, not just fallback:
   Gateway candidate fallback, and AgentRuntime's format-repair pass, which previously replayed the same
   prompt when the first response failed schema validation. A protected malformed response now returns a
   classified failure naming the refusal.

### Enumerated paths

| Path | Protected request |
|---|---|
| Gateway candidate fallback | refused |
| AgentRuntime format repair | refused |
| HTTP transport retries | none exist in the adapter |
| Streaming reconnection | none exists |
| Browser authentication retry on 401 | occurs before execution; no model call is made |
| Persisted job recovery / lease resumption | re-enters with the same classification; no new inference without a new request |
| Owner-initiated resubmission | permitted, and is the owner's decision |
| 409 cancellation | no retry; the interface distinguishes it from a state conflict |

### Residual limitations

- A caller holding the Gateway token can send `0`. Fail-safe covers omission, not a deliberate lie;
  closing that requires per-request authorisation at the Gateway.
- Record-level revocation does not remove personal facts from turns already stored in a conversation.
  The guarantee is non-retransmission, not forgetting.
- No atomicity across a network socket is claimed, and no database transaction is held across
  inference.
