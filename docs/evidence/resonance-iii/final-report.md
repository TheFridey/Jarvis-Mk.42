# RESONANCE III — checkpoint report

Baseline `bcc438f`. This is a partial campaign: Phase Zero is complete and committed; the voice loop is
not built. Stating that plainly is more useful than dressing up an audit as an implementation.

## Phase Zero — complete

| Item | Status |
|---|---|
| 5.1 Raw query text removed from diagnostics, with sentinel regression | VERIFIED |
| 5.3 Missing evidence must not become a negative conclusion (companion + advisor registers) | VERIFIED (prompt-level guidance, 103 cognition tests pass) |
| 5.4 `jarvis-up.ps1 -RestartApp` stops only Jarvis app trees, preserves the data plane, refuses foreign port holders | IMPLEMENTED, not yet exercised against a running app |
| 5.4 PostgreSQL `pg_isready` readiness with 30 s bound, fail closed; migration failure aborts startup | IMPLEMENTED, `-Check` passes |
| 5.2 NO_ROUTE second-turn intermittency | **NOT RESOLVED** — see below |

## 5.2 NO_ROUTE — what is known

The second conversational turn is intermittently refused with `NO_ROUTE` (HTTP 503) before any provider
is contacted. It reproduced in roughly half of the automated browser runs and never in seven consecutive
owner live turns. The refusal comes from routing, not privacy: `NO_ROUTE` means no candidate model
satisfied the request's constraints. Not root-caused; it does not block voice work, because it affects
the conversation path identically for typed and spoken input, and the owner has not hit it live.

## Voice engine — qualified, with a measured blocker

Kokoro-82M (`bm_george` / `bm_lewis` / `bm_fable`) is the provisional engine: Apache-2.0, local, British
male voices, real synthesis verified on this ARM64 machine. Measured RTF **2.14** — slower than real time,
which fails the "first audio under a second" target for a whole answer. Sentence-chunked synthesis is the
mitigation to build next. 15 audition WAVs are on disk for the owner.

## Not implemented

- The capture → transcript → conversation → synthesis → playback loop.
- Any audio playback in Presence.
- Continuous session turn-taking, manual interruption, automatic barge-in.
- Audio-reactive orb changes and the redesigned voice controls.

## Verification executed

| Check | Result |
|---|---|
| Cognition suite (identity guidance) | 103 passed |
| Experience suite (selection, trace privacy) | all pass, exit 0 |
| `jarvis-up.ps1 -Check` | preflight OK, containers healthy, nothing started |
| Kokoro audition | 15 WAVs, RTF 2.14 measured |

## Honest position

Jarvis still cannot speak. He can transcribe, and he can synthesise, and those two pieces were already
tested before this pass — what is missing is the loop that joins them to the conversation he already has.
The engine is chosen and measured; the next checkpoint is the loop, not another audit.
