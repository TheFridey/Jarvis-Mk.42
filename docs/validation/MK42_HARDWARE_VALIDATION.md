# MK.42 Workstation Hardware Validation

This report distinguishes physical evidence from automated simulation. Run `pnpm hardware:validate` for the non-destructive device inventory; its machine-readable result is written to `artifacts/hardware-validation/latest.json`. CI does not run this tier.

## Workstation observed on 8 September 2026

- OS: Microsoft Windows 11 Home 10.0.26200, build 26200, ARM64.
- Display: one active `Samsung Monitor Device`; Windows reported `\\.\DISPLAY1`, primary, 1536x864 (1536x816 working area).
- Microphone: `Microphone Array (Qualcomm(R) Aqstic(TM) ACX Static Endpoints Audio Device)`, PnP status OK.
- Speaker: `Speakers (Qualcomm(R) Aqstic(TM) Audio Adapter Device)`, PnP status OK.
- Camera: Windows identified Qualcomm Spectra 695 ISP camera, MipiCsi, AVStream, front sensor, platform and JPEG encoder devices. Windows did not expose a reliable retail camera model name.

## Actual results

| Capability | Result | Evidence |
|---|---|---|
| Device and default endpoint discovery | PASS | Windows PnP returned active microphone, speaker and camera endpoints named above. |
| Display topology discovery | PASS | Windows returned one active primary display and its coordinates. |
| Multiple-display interaction | NOT TESTED | Only one active display was available. |
| Microphone capture, wake phrase and transcript | NOT TESTED | No operator speech was supplied during this run. Endpoint enumeration is not capture proof. |
| Audible TTS response | NOT TESTED | An available speaker endpoint is not evidence that speech was heard. |
| Voice-to-Kernel, model response and follow-up | NOT TESTED | Requires an operator utterance and configured model provider. |
| Physical barge-in and acoustic self-trigger | NOT TESTED | The playback-reference echo guard has automated state-machine coverage, but the speaker-to-microphone acoustic loop was not physically observed. |
| Camera acquisition and MediaPipe load | NOT TESTED | Must be confirmed in the browser camera UI with permission granted; device presence alone is insufficient. |
| Hand tracking and real Air Touch gesture sequence | NOT TESTED | No human hand gesture was performed. |
| Camera/microphone disconnect and reconnect | NOT TESTED | Deliberate device disruption was not performed automatically. |
| Active application, title, cursor and monitor context | NOT TESTED | Collection code exists, but this report does not substitute source evidence for an observed live sample. |
| Selected-frame vision and first multimodal test | NOT TESTED | No selected region, physical pointing interaction, or confirmed vision-capable provider was exercised. |

## Fixes applied during this validation

- Voice and vision clients exchange the bootstrap credential for a scoped, node- and session-bound access credential; the bootstrap secret is no longer sent on perception RPCs.
- Voice playback now keeps a local text reference and suppresses high-overlap recognizer hypotheses during playback and a short tail. A dissimilar hypothesis still interrupts speech, preserving genuine barge-in.
- MediaPipe hand landmarks no longer claim that a person is present. The hand-only pipeline emits neither “person present” nor “person absent”.
- Browser credential query data is removed from the address bar immediately after startup. Continuous camera frames remain local; only derived hand events and explicitly permitted screen context leave the vision process.

## Measured latency and residual work

No physical latency samples were obtained, so activation-to-listening, transcript, first-response, first-audio, barge-in-stop, frame-to-landmark and gesture-to-action latency remain **NOT TESTED**. They must not be inferred from unit tests. Complete the interactive voice, camera, Air Touch, disconnect/reconnect, privacy, selected-frame and multimodal sequences on the workstation and append the observed metrics without raw audio or video.
