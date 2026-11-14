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
