# Runtime diagnostics

## The defect

`http-server.ts` returned the classified response for a `ModelGatewayError` before reaching the generic
failure logger, so the owner's stderr held one provider event and no explanation.

## Now logged

```
{"component":"diagnostics","event":"inference.failed","severity":"ERROR","node":"local-server",
 "status":503,"code":"NO_ROUTE","provider":null,"retryable":false,"stage":"model-inference"}
```

Allowlisted fields only: status, code, provider, retryable, stage. No body, prompt, statement,
exception text or credential.

This was exercised for real during verification: a turn submitted while the interface was still
thinking was refused with `NO_ROUTE 503`, and the classification appeared in the Kernel's stderr - the
kind of failure that was previously invisible.

## Frontend

| Kernel response | Before | Now |
|---|---|---|
| 503 | classified message | unchanged |
| 422 | `KERNEL_COMMAND_REJECTED_422` | classified: cut short, nothing resent |
| 409 CANCELLED | "state conflict", refreshed and resubmitted | classified cancellation, no resubmission |
| 409 state version | refresh | unchanged |

## Disclosure trace

`JARVIS_TRACE_DISCLOSURE=1` makes the Gateway log `{"event":"disclosure.classified","disclosure":...}`;
this is what the browser journey asserts.

## Not established

The original live 422 cannot be re-classified after the fact. Truncation of a 16-record deep
encouragement at the 2000-token ceiling after 23.8 s remains the only consistent explanation.
