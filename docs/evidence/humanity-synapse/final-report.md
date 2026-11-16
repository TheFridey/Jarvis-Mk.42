# OPERATION SYNAPSE — final report

Baseline `10b7cde` → this pass. Owner data untouched: no statement read, no approval, grant,
reclassification, adoption or reimport. Verification used synthetic fixtures and metadata only.

## What changed

1. **Register and retrieval intent separated.** `retrieval-intent.ts` decides evidence; the register
   still decides tone. Casual phrasing no longer caps a comprehensive question at two records.
2. **Ceilings follow the question.** SOCIAL 2 · BANTER 1 · TARGETED_FACT 4 · ENTITY_DETAIL 10 ·
   CAREER_HISTORY 15 · PROJECT_INVENTORY 15 · RECENT_PROGRESS 12 · PROFILE_OVERVIEW 20 ·
   ENCOURAGEMENT 16 · COMPREHENSIVE_RECALL and FOLLOW_UP 24 · TECHNICAL_OPERATION 3 ·
   GENERAL_KNOWLEDGE 0 (memory not consulted). Ceilings are maxima, never targets.
3. **Diversity before depth.** At most two records per entity key for broad questions, then a second
   pass fills leftovers only if nothing diverse remains.
4. **Honesty about scope.** The block names itself a partial view and how many eligible records it
   drew from — so "that is all I have" stops being a guess.
5. **Diagnostics extended** — intent, ceiling, distinct entities, category coverage, estimated tokens
   added to the existing `JARVIS_MEMORY_TRACE` line. Counts only, never content.

## Why, from the owner's own traces

Candidates 123, cloud-eligible 92, selected 2/2/2/5/7/8/2, largest block 1,359 bytes (~340 tokens).
The final turn shows **0 irrelevant and 90 budget-dropped**: every eligible record passed relevance
and the ceiling discarded 90 of them. The first turn shows the opposite — 54 irrelevant, 2 selected.
One number was serving two different questions.

## Baseline vs final

| Metric | Baseline | Final | Delta |
|---|---:|---:|---:|
| Passing | 849 | **862** | +13 |
| Failed | 0 | **0** | 0 |
| Skipped | 6 | **4** | −2 (PostgreSQL gates ran) |
| Files | 142 | **143** | +1 |
| Fitness | 17/17 | **17/17** | 0 |

Synthetic coverage, cloud locality:

| question | before | after |
|---|---:|---|
| broad career, casual phrasing | 2 | ceiling 15, ≥3 distinct careers |
| project inventory | 5 | ceiling 15, ≥3 distinct projects |
| profile overview | 2 | ceiling 20, ≥3 categories |
| reflection | 7 | ceiling 12 |
| hype | 8 | ceiling 16 |
| general knowledge | consulted memory | **0 — not consulted** |

## Phase classifications

| Phase | Status |
|---|---|
| 0 preflight | **VERIFIED** |
| 1 intent/register separation | **VERIFIED** |
| 2 adaptive budgets | **VERIFIED** (token figures approximated) |
| 3 diversity and ranking | **PARTIAL** — diversity yes; ranking still lexical |
| 4 follow-up expansion | **PARTIAL** — wider ceiling and diversity; cannot exclude entities already mentioned |
| 5 completeness honesty | **VERIFIED** |
| 6 personality synthesis | **NOT IMPLEMENTED** |
| 7 diagnostics | **VERIFIED** |
| 8 browser-to-provider proof | **NOT IMPLEMENTED** |
| 9 retry consent protection | **NOT IMPLEMENTED** |
| 10 ORACLE queue | **NOT INVESTIGATED** |
| 11 infrastructure | **NOT CHANGED** — recommendation only |
| 12 synthetic evaluation | **PARTIAL** |

## Honest position

The retrieval defect behind "Stigma eSports is the only pre-X work I have" is addressed at the level
of *what is selected* and *what the model is told about its own scope*. Not proven: that a real
Presence request now carries this context to the provider. That needs the browser harness — a build
— and this pass spent its budget on the retrieval change rather than proving it.

Still visible to the owner until phase 6: occasional narration of memory ("I've got on record"), and
reflective answers that remain more analytical than emotional.

## Verification

```
node $pnpm exec tsc -p tsconfig.json --noEmit   # clean
node $pnpm lint                                  # clean
node scripts/run-gate.mjs fitness                # 17/17
JARVIS_DB_URL=... node $pnpm exec vitest run     # 862 passed, 4 skipped, 143 files, exit 0
```

## Owner retest

Restart the Kernel, open a fresh conversation, and run the acceptance prompts plus:

- "Mate, tell me everything you know about my previous career." — several distinct experiences, and
  language that admits the view may be partial.
- "What else haven't you mentioned?" — a wider set, not a repeat.
- "What's the difference between ionic and covalent bonds?" — no personal context at all.
