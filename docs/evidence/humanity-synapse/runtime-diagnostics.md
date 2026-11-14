# Runtime diagnostics

## The defect

`http-server.ts` returned the classified HTTP response for a `ModelGatewayError` before reaching the
generic failure logger. The owner's stderr therefore contained one provider-request event for
correlation `cd714b2f-8b24-4e0b-93b5-98bb980ebed6` and nothing explaining the 422 - the classification
existed and was thrown away.

## Now logged (allowlisted, metadata only)

```
{"component":"diagnostics","event":"inference.failed","severity":"ERROR","node":"...",
 "status":422,"code":"INVALID_RESPONSE","provider":"openrouter","retryable":true,
 "stage":"model-inference"}
```

Deliberately absent: request body, prompt, memory statements, raw provider error text, exception
messages, credentials. The generic handler's `redactFailure()` is pattern-based and cannot promise that
arbitrary personal content is removed, so classified failures use fields that are safe by construction
rather than sanitised after the fact.

## Frontend

| Kernel response | Before | Now |
|---|---|---|
| 503 | classified message | unchanged |
| 422 | `KERNEL_COMMAND_REJECTED_422` | classified message stating the answer was cut short and nothing was resent |
| 409 CANCELLED | treated as state-version conflict, refreshed and resubmitted | classified cancellation, no resubmission |
| 409 state version | refresh | unchanged |
| malformed error body | n/a | generic message |

## Disclosure trace

`JARVIS_TRACE_DISCLOSURE=1` makes the Gateway log `{"event":"disclosure.classified","disclosure":...,
"correlationId":...}` - the classification only, which is what proves the marker survived the hop.

## Not established

The original live 422 cannot be re-classified after the fact: it was never logged, and no record of the
provider's `finish_reason` was kept. Truncation of a 16-record deep encouragement at 2000 tokens after
23.8 s is the only explanation consistent with every observed number, and it is now reproducible and
fixed, but it remains inference rather than a captured fact.
