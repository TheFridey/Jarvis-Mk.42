# Memory privacy matrix — final ascension

Every row was executed by `scripts/provider-wire-proof.ts` against the real chain (selector →
orchestrator → AgentRuntime → gateway process → `OpenAICompatibleAdapter` → mock provider) and the
verdict is read from the **final outbound provider body**, not from a policy return value.

Synthetic principal `synthetic-wire-principal`. Sentinels are invented strings.

| # | Case | Class / state | Consent | Expected | Observed | Body bytes |
|---|---|---|---|---|---|---|
| 1 | eligible internal, relevant | INTERNAL, approved | cloud granted | present | **present** | 8,510 |
| 2 | internal without consent | INTERNAL, approved | none | absent | **absent** | 8,346 |
| 3 | pending | INTERNAL, pending | n/a | absent | **absent** | 8,346 |
| 4 | sensitive | SENSITIVE, approved | none | absent | **absent** | 8,346 |
| 5 | restricted | RESTRICTED, approved, flagged eligible | n/a | absent | **absent** | 8,346 |
| 6 | revoked | INTERNAL, revoked | n/a | absent | **absent** | 8,346 |
| 7 | deleted | `[deleted by owner]` | n/a | absent | **absent** | 8,346 |
| 8 | superseded | INTERNAL, superseded | n/a | absent | **absent** | 8,346 |
| 9 | cross-principal | other principal's record | n/a | absent | **absent** | 8,346 |
| 10 | irrelevant but eligible | INTERNAL, unrelated subject | granted | absent | **absent** | 8,346 |
| 11 | injection record | INTERNAL, contains an instruction | granted | present as **data** | present | 8,552 |
| 12 | authority under injection | same request | — | authority contract intact | **intact** (`you propose, the Kernel acts`) | — |
| 13 | revoked after selection | revoked 1 s before dispatch | n/a | absent | **absent** | 8,346 |

Notes that matter:

- Row 5 is the class ceiling doing its work: the record was *flagged* cloud-eligible and still did
  not travel, because eligibility is a grant and the ceiling is a policy limit. A flag cannot
  lower a classification.
- Row 11 is deliberate: an eligible, relevant memory containing an instruction may travel **as
  data**. Row 12 proves the instruction did not become authority — the constraints block in the
  same request still carries the contract.
- Row 13 exercised revalidation: the record was selected, then revoked, then recomposed to `''`.
- Bytes are stable at 8,346 when no memory block is present, which makes an accidental inclusion
  visible at a glance.

Not exercised by this harness, and not claimed: provider fallback, retry, cancellation and
streaming-vs-generative variants beyond the SSE path the real client already uses.
