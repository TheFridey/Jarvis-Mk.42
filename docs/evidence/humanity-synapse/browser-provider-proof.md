# Production browser-to-provider proof

## What was exercised

`scripts/convergence-acceptance.ts` starts the application the way the launcher does:

```
HTTP client (stands in for Presence)  -> real Kernel bootstrap (isolated DB, synthetic principal)
  -> /auth/session (201, desktop.write) -> /desktop/conversations/grant -> /desktop/cognition
  -> real memory repository (isolated PostgreSQL, real migrations)
  -> retrieval intent + selection -> ContextCompiler -> AgentRuntime
  -> HttpModelGatewayClient -> real Gateway process -> real OpenAICompatibleAdapter
  -> loopback mock provider (captured bodies)
```

| Component | Status |
|---|---|
| Kernel bootstrap and node registration | REAL (synthetic principal `synthetic-convergence-owner`) |
| HTTP auth, grant, desktop cognition routes | REAL |
| PostgreSQL memory repository | REAL, isolated database created and migrated per run |
| Retrieval intent, selection, diversity | REAL |
| ContextCompiler, AgentRuntime, gateway client | REAL |
| Gateway process and OpenAICompatibleAdapter | REAL |
| Browser | SUBSTITUTED — an HTTP client sends the same request |
| Provider | SUBSTITUTED — loopback fixture |

## Result: the payload is right, the envelope is not

Seven of thirteen checks pass. Every payload assertion passes:

| turn | bytes to provider | required sentinels | forbidden sentinels |
|---|---:|---|---|
| career history | 14,950 | present | absent |
| project inventory | 18,969 | present | absent |
| profile overview | 19,866 | present | absent |
| encouragement | 19,755 | present | absent |
| general knowledge | 17,956 | none required | absent |
| greeting | 17,876 | none required | absent |

The six failures are all one thing: the Kernel answers `{"error":"internal_error"}` **after** the
provider request has been sent. So memory demonstrably reaches the provider through the real path,
and the turn still does not complete. Verified from the kernel trace lines instead:

```
intent=ENCOURAGEMENT limit=16 selected=10 distinctEntities=10 categoriesCovered=6
intent=GENERAL_KNOWLEDGE limit=0 selected=0 blockBytes=0
intent=SOCIAL limit=2 selected=1 blockBytes=82
```

## The defect this found

`/desktop/cognition` maps an exception after dispatch to `internal_error` and logs nothing. That is
exactly the class of failure the previous campaigns kept hitting: a real fault, invisible from the
outside. It is not fixed here — I ran out of budget chasing it — and it is the first thing to fix
before live acceptance, because a successful provider call that reports failure is worse than no
call at all.

Reproduction: `node $pnpm exec tsx scripts/convergence-acceptance.ts` (creates and drops its own
database; needs the local stack and no credentials).

## Not proven

- That a real browser, as opposed to an HTTP client with the same headers, behaves identically
  (session storage, state version churn, retries).
- Prose quality. The provider is a fixture; nothing here says anything about how the answer reads.
