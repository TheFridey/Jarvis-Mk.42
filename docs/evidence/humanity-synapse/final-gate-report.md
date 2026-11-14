# CLOSURE FINAL GATE — report

Baseline `3f1eb3e` → this pass. Owner data unchanged.

## Baseline vs final

| Metric | Baseline | Final |
|---|---:|---:|
| Passing tests | 865 | **879** |
| Failed | 0 | **0** |
| Skipped | 4 | **4** |
| Test files | 143 | **145** |
| Fitness | 17/17 | **17/17** |
| Convergence acceptance | 13/13 | **13/13, exit 0** |

## Retry protection — VERIFIED

Five behavioural tests against two live loopback providers, asserting request counts:

- ordinary request falls back: A=1, B=1
- memory-bearing success: A=1, B=0
- memory-bearing failure: A=1, **B=0**, throws `retry refused`
- refusal is `retryable: false`
- cancellation stops before a second attempt

Audited other paths: adapter issues one fetch, no transport retry, no SDK, no streaming reconnect, no
runtime retry. Candidate fallback was the only autonomous retransmission path.

## Context ceiling — VERIFIED

Ceilings are **estimated** tokens (4 bytes each), documented as estimates. `fitMemoryToCeiling`
greedily accepts whole records and **omits** any that would exceed the ceiling; if nothing fits,
nothing is sent. A single oversized record can no longer blow the limit, and a statement is never
truncated into a different fact.

| edge case | behaviour |
|---|---|
| record larger than the whole budget | omitted, block empty |
| large record beside small ones | large omitted, small kept, under ceiling |
| multibyte text | counted by UTF-16 length (conservative) |
| zero-budget intent | always empty |

## Diagnostic privacy — VERIFIED

`redactFailure()` strips `sk-…` keys, `Bearer` tokens and `key=`/`password=`/`token=` fragments before
the message reaches the log, then caps at 300 characters. Five tests cover each shape plus an
ordinary message and the length bound. Length was never redaction; this is.

## Browser Presence journey — NOT IMPLEMENTED

The HTTP client still stands in for the browser. Building the journey needs the static export built
with an isolated kernel URL, a driven Chrome session through Presence, and assertions on rendered
state — a new harness, not a fix, and this pass spent its budget on the retry and ceiling
verification that the campaign ranked higher. `convergence-acceptance.ts` proves everything behind
the socket; nothing here proves the interface.

## ORACLE — NOT INVESTIGATED

## Honest notes

- The acceptance harness now fails closed: a transient kernel-start timing failure previously exited
  0 before the summary. Fixed during this pass.
- Token counts are estimates. No tokenizer was added.
