# JARVIS · Resonance II — first pass

Baseline `f265a1a`. Owner's `jarvis-up.ps1` correction preserved and committed with the
preflight that makes it unnecessary to fix by hand again.

## The defect you reported

> "The mic worked (but stayed on for ages after I finished speaking)."

Cause, measured rather than guessed: the detector compared every frame to **one fixed
threshold (0.006 RMS)**. A room with any steady noise — a fan, a fridge, a laptop — sits above
that, so "silence" never arrived and capture only ended at the 20-second ceiling. The silence
timer was correct; the threshold was not.

`voice-vad.ts` replaces it with a state machine that measures the room first:

| | before | now |
|---|---|---|
| Noise floor | none | learned over the first 300 ms, capped at 0.03 |
| Start threshold | 0.006 (fixed) | `max(0.009, floor × 3.2)`, two consecutive frames |
| End threshold | 0.006 (same as start) | `max(0.006, floor × 2)` — hysteresis |
| Silence to end | 900 ms wall clock | 850 ms of continuous frames |
| Minimum speech | none (a cough counted) | 250 ms of *voiced* frames, else retracted |
| Nothing said | waited 20 s | `no-speech` at 8 s |
| Ceiling | 20 s | 20 s |

Measured on synthetic energies with known boundaries: **trailing silence 800–1200 ms** in a
0.012-RMS room, no premature cut at a 384 ms breath, a 128 ms cough retracted rather than
transcribed, silence-only ending at 8 s.

## Why "Go Tom Phil" became "Tom Phil"

Two plausible causes, one fixed, one measured:

1. **Leading audio was discarded** — `start()` resolved after the `AudioContext` was built, so
   the first 100–300 ms of speech was lost. The recorder now keeps an 8-frame (~0.5 s) pre-roll
   ring and prepends it at `speech-start`.
2. **Recognition itself** — untested for that phrase. base.en on a short two-word utterance
   with a clipped onset is exactly the case where a smaller model struggles; I have not
   replaced it, because the capture defect is the more likely explanation and the model is
   verified (RTF 0.17).

Still unmeasured: word error rate on short phrases, names and identifiers. That needs your
microphone or a new fixture set; I did not synthesise a benchmark and call it accuracy.

## Launcher

- `Assert-CleanPath` runs **before** any environment value is set: no control characters, no
  blank paths, forward slashes throughout.
- Your correction is what is now committed; `scripts/jarvis-up.ps1.bak` is ignored, not
  deleted.
- Regression: `launcher-hygiene.test.ts` asserts the script contains no control characters, no
  backslash paths in speech configuration, and that preflight precedes use. It caught two real
  backslash paths that were still present.

## Not done in this pass

Honest, because the remaining items are large and I would rather tell you than half-build them:

- **Dedicated voice session** — still the desktop session. A `voice.write` session with explicit
  states and server-enforced transitions is designed in `docs/JARVIS-VOCALIS-CONNECTION.md` but
  not implemented.
- **Kokoro** — not attempted. Assets stay absent; System.Speech remains the working voice.
- **Audio-reactive orb** — microphone amplitude is now measured (`onLevel`) but nothing consumes
  it; playback amplitude is not wired. The orb still does not react.
- **Voice control presentation** — the MIC and VOICE buttons are functional, correctly disabled
  and keyboard reachable, but they are not yet integrated into the SENTIENCE design language.
- **Conversational mode** (automatic submission) — not implemented; review-before-submit stands.
- **Provenance metadata** — speech input is not yet marked as such to the model.

## Your checkpoint

No restart is needed for the VAD change *in the browser* — the export must be rebuilt and
reserved, which it has been; reload the page. The Kernel is unchanged in this pass.

Then: press MIC, say "Evening, Jarvis.", and watch how long the button stays lit after you
stop. Target is under ~1.2 s. If it hangs, tell me the room (fan? TV?) and I will raise the
floor cap rather than guess.
