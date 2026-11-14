# Output allowance evaluation

## Original state

- `MAX_COGNITION_OUTPUT = 2000` - one number for every kind of request.
- `boundedOutput()` clamped any client hint to it; no caller supplied one, so every turn received 2000.
- The adapter sent `max_tokens: budget.maxOutput`; a provider `finish_reason: 'length'` became
  `truncatedOutput()` then `ModelGatewayError('INVALID_RESPONSE', retryable: true)`.

That is the live 422: a deep personalised encouragement answer carrying 16 memories was cut off at 2000
tokens after 23.8 s, and the Kernel correctly refused to treat the fragment as a valid proposal.

## Policy now

`outputAllowanceFor(intent)` in `retrieval-intent.ts`, applied by `CompanionService`:

| Intent | Allowance |
|---|---:|
| SOCIAL, BANTER | 512 |
| TECHNICAL_OPERATION | 768 |
| TARGETED_FACT | 1024 |
| GENERAL_KNOWLEDGE, PERSONALISED_EXPLANATION | 1536 |
| ENTITY_DETAIL, RECENT_PROGRESS | 2048 |
| PROJECT_INVENTORY | 3072 |
| CAREER_HISTORY, PROFILE_OVERVIEW, REFLECTIVE, FOLLOW_UP | 4096 |
| COMPREHENSIVE_RECALL, ENCOURAGEMENT | 6144 |
| Hard ceiling | 8192 |

The ceiling moved from 2000 to 8192. That is a real change in what a single turn may spend, made
because 2000 made a legitimate answer impossible; it is a ceiling, not a default, and every turn still
receives only its intent's allowance.

## What is not claimed

- No wire capture of `max_tokens` was taken this pass; the values are asserted at the policy layer and a
  test pins every intent under 8192.
- Reasoning-token accounting is unchanged: a model that spends allowance on hidden reasoning still
  truncates, and still produces a classified, explicitly non-retransmitted failure.
- Cost: a worst-case turn can now ask for roughly three times the output it could before. Cost
  accounting is unchanged and still cumulative per job; the operator's limits still apply.
