# Audio and diagnostics privacy

## Raw query leakage — corrected

The live recall traces contained the owner's actual sentence, and for a follow-up the *reconstructed*
previous-plus-current query. That is a private conversation written into a log file.

`memoryTrace()` now emits counts only: correlation id, intent name, query character count, topic character
count, candidate/approved/irrelevant/cloud-ineligible/ceiling-exceeded/already-provided/budget counts,
selected count and block bytes. No text, no record ids, no statements.

Regression: `memory-selection.test.ts` builds a trace from a query containing `ZEBRA-SENTINEL-QUERY` and a
memory statement containing `SENTINEL-STATEMENT-7731`, then asserts neither appears in the serialised line
and that `queryChars`/`selected` do.

Historical logs are **not** modified or deleted: that is the owner's decision. Existing files under
`.logs/` may contain earlier traces with raw queries and should be treated as private.

## Audio boundaries (as implemented today)

| Boundary | State |
|---|---|
| Recognition | local whisper.cpp; no audio leaves the machine |
| Synthesis | local Kokoro / local SAPI; no text leaves the machine for speech |
| Transcripts in logs | not logged by the utterance service; the transcript becomes a normal conversation command |
| Temporary audio | utterance body held in memory only; synthesis temp files removed in `finally` |
| Retention | no recordings are written to disk by design |

## Residual limitations

- The conversation command built from a transcript is subject to the same disclosure rules as typed text;
  nothing about voice widens them.
- Kokoro fetches its model once from Hugging Face; that request contains no owner text.
- Barge-in does not exist, so there is no echo-cancellation boundary to reason about yet.
