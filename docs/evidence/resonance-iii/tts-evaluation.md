# TTS evaluation

## Candidates, on this workstation (Windows 11 ARM64, Snapdragon X Plus, 16 GB)

| Engine | Availability | British male voice | Licence | Verdict |
|---|---|---|---|---|
| Windows SAPI (System.Speech) | installed | **none** — Hazel en-GB female, Zira en-US female | OS component | Fallback only; wrong voice, robotic delivery |
| Piper | not installed; no arm64 Windows binary or wheel established | n/a | MIT / voice-dependent | BLOCKED on this architecture |
| Kokoro-82M via `kokoro-js` + `onnxruntime-node` arm64 | **works** | `bm_george`, `bm_lewis`, `bm_fable` | Apache-2.0 model; voices from a permissively licensed dataset | **Provisional engine** |
| Cloud TTS | n/a | n/a | n/a | Excluded: owner text must not leave the machine |

## Measured (real synthesis, this machine, q8 on CPU)

Command: `node node_modules/tsx/dist/cli.mjs scripts/voice-audition.ts`

```
15 samples: 198.8 s of synthesis for 92.9 s of speech -> RTF 2.14
per utterance: 7.4 s - 14.7 s for 3.6 s - 7.9 s of audio
```

Audition WAVs are in `docs/evidence/resonance-iii/audition/`, five scripts × three voices, identical text
per script so comparison is direct.

## The problem this exposes

RTF 2.14 means the machine takes more than twice as long to speak as the speech lasts. A seven-second
answer would take fifteen seconds to produce. The performance target was first audio under one second;
this engine on this CPU cannot meet that for a whole answer.

Options, in order of preference:

1. **Chunk by sentence and play as you go.** First audio then costs one short sentence (~2–4 s at this
   rate, measured from the 3.6 s sample at 7.4 s) rather than the whole answer. Still above target, but
   the gap is "a pause", not "silence".
2. **A smaller/faster model or int8 with fewer threads** — not measured; q8 is already the small variant.
3. **Piper with a UK male voice**, if an arm64 Windows build can be established. Earlier campaigns found
   no arm64 wheel for comparable Python TTS stacks, so this is a research task, not a download.

## Subjective quality

Not claimed. The owner must listen to the samples; that is the only valid test of whether a voice sounds
like Jarvis rather than like a synthesiser. `bm_george` is the closest to the requested calm British male
register in casual listening, `bm_lewis` is lighter, `bm_fable` is more neutral — but this is the owner's
decision, not mine to make.
