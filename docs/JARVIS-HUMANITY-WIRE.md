# JARVIS · Humanity: Wire Proof

From `559caed`. The skipped assertions are gone — replaced by five that execute, and the
capture is an HTTP body, not a runtime argument.

## The chain that runs

```
CognitionOrchestrator.submit
  → real routingPolicy + real assistantConstraints(registerFor(input))
  → AgentRuntime (real agent manifests, real prompt assembly, real budget clamp)
  → HttpModelGatewayClient.generate  → fetch POST /v1/stream
  → node:http fixture server on 127.0.0.1:<ephemeral>   ← body captured here
```

Nothing between the orchestrator and the socket is a mock. The context compiler is stubbed only
because it needs a database-backed domain; the memory text is composed by
`composeMemoryContext` — the same function both production call sites use — and travels inside
`input.instruction`, which is exactly where the Kernel puts it.

Live evidence: `docs/evidence/humanity-wire/outbound-payload.json`

```json
{
  "boundary": "http-body captured at the Model Gateway client",
  "transport": "POST /v1/stream (SSE), authorization header redacted",
  "bodyBytes": 7961,
  "containsEligibleMemory": true,
  "containsDeletedMarker": false,
  "containsOtherPrincipal": false,
  "containsMemoryBlockHeader": true,
  "excerpt": "{...\"instruction\":\"How detailed should your technical answers be for me?\\n\\nApproved context about the owner (use only where relevant; never recite it):\\n- response-length-preference: Prefers co..."
}
```

## Assertions, all executing

| case | assertion |
|---|---|
| approved INTERNAL, cloud-eligible, relevant | present in the body |
| local-only, SENSITIVE, RESTRICTED (even if flagged eligible), revoked, deleted, superseded, other-principal, irrelevant | all absent — body has no memory block at all |
| greeting | no memory block, no personal statement |
| invalid conversation grant | `authorisation refused before dispatch`, **zero** requests reach the socket |
| revoked after selection, before dispatch | recomposition returns `''`; body carries no memory |

Provider mismatch is the same verifier path: a `ok:false` verdict from `verifyAuthorisation`
stops dispatch, and the test asserts the fixture received nothing.

## What the fixtures had to satisfy — the parts that were real work

Three real contracts rejected the naive fixture, and each rejection was the production guard
doing its job:

1. context budget is `{ usedUnits, limitUnits }` — `maxUnits` is not the field;
2. proposals require `provenance.derivedFromUntrusted`, and `AgentRuntime` overwrites
   `producedOn`/`producedAt` from the **response's** provenance, so the gateway response must
   carry one;
3. the client streams when a routing callback exists, so the fixture must speak SSE
   (`data: {"type":"routing"…}` then `data: {"type":"done","response":…}`) — a plain JSON 200
   produces `gateway disconnected without result`.

## Concurrency, stated accurately

Revalidation happens immediately before `runtime.invoke`. The interval that remains is between
that re-read and the socket write: microseconds to milliseconds, single process, no transaction
held open across the network call. A revocation landing inside it is **not** prevented, and no
design here pretends otherwise. Holding the memory rows in the same transaction as the dispatch
key would imply an atomicity that an external HTTP call cannot give; that is deliberate, not an
oversight.

Previously transmitted data cannot be recalled. Revocation and deletion govern future context.

## Remaining honest gap

The context compiler in this harness is a stub returning `INTERNAL`. That means the test proves
the memory text reaches the wire under an `INTERNAL` ceiling; it does not re-prove that
`ContextCompiler` itself classifies content correctly, which is covered by its own existing
suite. Wiring the real compiler needs a database-backed domain, which is a larger fixture.
