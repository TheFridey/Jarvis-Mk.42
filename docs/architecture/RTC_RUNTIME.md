# Local RTC runtime

Implemented 2026-10-03. This supersedes the deployment deferral in ADR-0012 for
the trusted desktop on this workstation. Mobile/wall microphone admission and
remote internet deployment remain deferred.

Browser microphone → private local LiveKit room → Kernel RTC agent → local or
explicitly selected cloud ASR → authenticated VoiceGateway → Context Compiler →
permissioned model route → validated proposal → local/cloud TTS → WebRTC reply.
The browser owns microphone lifecycle and presentation; the Kernel owns identity,
conversation sessions, context, model routing and permissions.

## Use

Refresh the desktop at `http://127.0.0.1:7426`. Select **LOCAL SPEECH** or
**CLOUD SPEECH**, then press the microphone button and grant microphone access.
Press it again to stop. Local speech uses Windows System.Speech. Cloud speech
uses OpenAI transcription/synthesis and requires the existing `OPENAI_API_KEY`.
Cloud selection permits sending this session's audio to OpenAI; enabling cloud
model inference alone does not enable cloud speech. Local speech keeps raw audio
local, but derived text can use a cloud model when the existing context privacy
policy permits it. SENSITIVE/RESTRICTED knowledge still requires a local model.

`JARVIS_RTC_MODEL=openrouter/auto` selects the preferred voice cognition route.
The optional `JARVIS_RTC_ASR_MODEL` and `JARVIS_RTC_TTS_MODEL` override the cloud
speech defaults. Cloud ASR operates on bounded utterances, not token-by-token
streaming transcription. The fixed energy VAD uses 700 ms endpoint silence and
a 12-second segment limit. Acoustic threshold calibration remains unverified.

## Provision and launch

```powershell
pnpm exec tsx scripts/provision-rtc.ts
docker compose -f infrastructure/docker/local-server.compose.yml -f infrastructure/docker/rtc.compose.yml up -d
pnpm core:dev
pnpm gateway:dev
```

Provisioning preserves provider keys, creates local LiveKit credentials in the
Git-ignored `.env`, and writes the private server configuration into the
ACL-restricted, Git-ignored `artifacts/local-runtime/pki/livekit.yaml`.
Core and Gateway load the root `.env` even when launched from their packages.
LiveKit v1.9.12 exposes only loopback ports 7880/7881 TCP and 7882 UDP. This
configuration is for same-machine testing; it is not a LAN/internet deployment.

## Security and limitations

- `/rtc/join` and `/rtc/leave` require strong, recent, session-bound `voice.write`
  credentials on kernel-local or owned-secure desktop/workstation nodes.
  Mobile/display identities cannot use this desktop admission path.
- Rooms and participant identities are random. Client tokens grant only that
  room, microphone publication and subscription; no room administration, camera,
  screen share or application data publication. The client receives no service
  or provider secret.
- Kernel admission revalidates after connection; authority is checked every two
  seconds while active. Logout, expiry, node revocation or owner mismatch closes
  the room and voice session. Four rooms and twenty-minute sessions are bounded.
- LiveKit self-hosted participant tokens are not independently revocable. Initial
  JWT lifetime is 15 seconds; server-refreshed tokens may persist longer. Deleting
  the room and stopping the Kernel agent removes access to JARVIS processing, but
  a stolen media token can attempt recreation of its former empty room. This is
  an acknowledged media-token limitation, not instant cryptographic revocation.
- PCM stays in bounded memory buffers, is never written as an audio recording,
  and is sent to cloud ASR only in the explicitly selected cloud mode. Speech
  subprocess stderr and transcript text are not forwarded into runtime logs.
- Silence does not prove ASR accuracy. Local Windows recognition is sensitive
  to installed language/voice configuration. Generated speech was occasionally
  recognised imprecisely; a physical microphone/AEC/barge-in qualification remains
  required. A busy speech turn drops subsequent bounded segments; reliable queued
  multi-utterance transcription and measured speech latency remain future work.

## Verification

```powershell
pnpm lint
pnpm exec vitest run --project unit
pnpm build:desktop
pnpm exec tsx scripts/qualify-rtc.ts
pnpm exec tsx scripts/qualify-rtc.ts --cloud
pnpm exec tsx scripts/qualify-rtc.ts --revoke
```

The qualification harness creates an authenticated RTC session, publishes a
System.Speech-generated utterance over the real media server, and requires at
least ten returned frames with RMS above 300 (int16 scale). It labels input as
synthetic and never claims physical microphone verification. Both local and cloud
results must be reported separately. The browser page is checked separately for
the microphone control, processing selector and connection/errors.

Current gates: 81 unit files / 354 tests passed; typecheck and structural lint
passed; desktop production build passed. Local RTC media/speech round trip passed
with synthetic input. Cloud RTC media/ASR/cognition/TTS round trip also passed
with synthetic input. The earlier first desktop build failed on an unused import and
was corrected before the passing build. An initial weak audio-energy check was
replaced with the RMS threshold; earlier weak results are not acceptance evidence.

Follow-up qualification: a live authenticated session logout disconnected its
WebRTC participant in 869 ms. The `--revoke` gate tests this independently of
speech generation. It does not certify the documented stolen-token limitation.
Repeat local speech runs exposed an agent completion race: process exit could
overtake a result awaiting asynchronous heartbeat processing. The worker now
flushes its result before exit and the parent drains received frames before
classifying exit. The regression test deliberately delays a heartbeat while the
worker returns its result. Failures report only the speech mode and pipeline
stage, without transcripts, audio, provider responses or credentials.
After the fix, both local and cloud speech gates passed again against the
restarted Kernel, each receiving at least ten non-silent reply frames. The
worker completion regression passed (4 worker-host tests); the focused runtime
and RTC suite passed (10 tests before adding that regression). Fresh typecheck
and structural lint passed. The earlier 354-test suite and desktop build are
historical gates, not reruns of the newer desktop visual edits in the workspace.
The final revocation rerun passed in 1771 ms. Final browser verification showed
REALTIME LIVE, an enabled Start RTC voice control, both processing options and
no browser errors. Kernel `/healthz` returned HEALTHY with no critical issues.
