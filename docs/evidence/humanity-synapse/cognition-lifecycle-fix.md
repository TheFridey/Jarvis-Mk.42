# Cognition lifecycle fix

## Exact root cause

Two defects, one masking the other.

1. **Harness defect.** The provider fixture tried to echo the Kernel's `correlationId` back into the
   proposal, but the id reaches the gateway inside a JSON-encoded string, so the quotes are escaped
   (`\"correlationId\":\"...\"`). The fixture's regex never matched, fell back to an unrelated id,
   and `AgentRuntime` correctly rejected the proposal: *proposal correlation mismatch*. The provider
   call had already succeeded, so the turn died after inference.
2. **Production defect.** `/desktop/cognition` caught that error and returned `{"error":"internal_error"}`
   while logging only a bare event with no error name, code, message or frame. A working provider
   call was reported to the operator as a failure with nothing to debug.

## Fix

- Fixture: unescape the body before extracting the id, ignore the placeholder name, echo the real one.
- Endpoint: a bounded failure classification is now written to the kernel's stderr —
  `component, event, node, errorName, errorCode, errorMessage (≤300 chars), top three stack frames`.
  No request or response bodies, no statements, no credentials.

## Result

`scripts/convergence-acceptance.ts` — **13/13**, exit 0.

| check | result |
|---|---|
| isolated database migrated with the real migrations | PASS |
| synthetic repository holds the profile (14 active) | PASS |
| real gateway on an isolated port | PASS |
| real kernel from production bootstrap | PASS |
| kernel registered under the synthetic principal | PASS |
| authenticated desktop session issued | PASS |
| conversation cloud grant issued by the Kernel | PASS |
| career history / projects / profile / encouragement reach the provider | PASS (payload asserted) |
| general knowledge and greeting carry no personal context | PASS |
| forbidden records absent in every case | PASS |

## Is this a production defect?

Yes — not the mismatch (the runtime was right to reject a forged correlation id), but the silence.
That silence is what turned a fixture bug into six unexplained failures across a campaign. The
probe that fixed it is the diagnostic addition, not the regex.

## Regression coverage

The acceptance script is the regression: it exercises the real endpoint and asserts a completed
envelope, so the same silence cannot return unnoticed. No unit test could have caught it, because
the failure lived in the seam between a fixture's regex and a swallowed catch.
