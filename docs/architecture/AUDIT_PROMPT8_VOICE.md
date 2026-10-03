# Prompt 8 implementation audit

Voice V2 preserves the System.Speech fallback, adds interchangeable local audio
contracts and the optional offline Python inference path, and keeps Core
authoritative. See [architecture and setup](VOICE_V2.md).

Implemented boundaries include bounded capture/inference work, hypothesis/final
transcription, Jarvis wake detection, follow-up history, echo-reference filtering,
immediate playback abort on confirmed interruption, stale response suppression,
input/output selection, loss/reconnect and sidecar recovery, ephemeral derived
Experience projection, caption expiry, trace propagation, and a real operator
qualification command. Python receives no Kernel credential; no raw audio is
persisted by this runtime.

## Verification on 2026-10-02

| Check | Evidence |
| --- | --- |
| Typecheck and structural lint | `pnpm lint` passed. |
| Whole unit suite | 296 tests / 66 files passed before the final activation/playback race guard. |
| Fresh affected unit checks | 21 tests / 5 files passed on the final implementation, including delayed-utterance timing attribution. Coverage includes dormant privacy, wake boundary, wake/utterance race, stale replies, cancellation, same-session recovery, ended-session rejection, safe projections, credential coalescing and qualification evidence gating. |
| Python control tests | Four dependency-free tests passed: cancellation does not wait on synthesis lock, early cancellation cannot start synthesis, network blocking, protocol version validation. They do not exercise neural inference or hardware. |
| Real integration | Two PostgreSQL-backed voice suites passed: durable RTC follow-up/barge-in and authenticated HTTP audio projection with forged binding/PCM rejection. Cognition uses the explicit test Model Gateway, not a physically spoken acceptance interaction. |
| Contracts | 16 passed. |
| Security | 30 passed. |
| Architecture fitness | 17 passed. |
| Desktop production build | Passed, including TSX validity and static export. Generated tracked output restored to its pre-task state. |
| Preflight / OS inspection | Present microphone/speakers, registered en-GB recognizer, Hazel/Zira voices. Python 3.14.5 with no neural dependencies/models configured. |
| Physical acceptance / acoustic latency | Deferred at Rhys's request. NOT TESTED. |
| Neural inference startup / transcription / synthesis | NOT TESTED on this ARM64 workstation; supported interpreter/native dependencies and model assets still need provisioning. |
| Live browser audio interaction | NOT TESTED; production build and source tests do not prove it. |

The complete integration, chaos and backup/restore suites were not rerun for this
change. No production deployment or hardware certification is claimed.

`pnpm voice:qualify` records actual host timing samples when the operator runs
the real pipeline. The documented timing boundaries intentionally distinguish
host events from acoustic onset/offset. Reports remain unqualified until manual
checks, repeated wakes, all measured categories and the baseline are present.
Actual physical results remain explicitly blank in
[VOICE_QUALIFICATION_RESULTS.md](VOICE_QUALIFICATION_RESULTS.md).
