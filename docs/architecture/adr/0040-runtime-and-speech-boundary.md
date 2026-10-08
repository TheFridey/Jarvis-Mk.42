# ADR-0040: Record the implemented runtime and enforce speech Gateway egress

Status: Accepted
Date: 2026-10-08
Supersedes: ADR-0001's framework choice; framework-specific details in ADR-0008 and ADR-0019.

## Context

The checked-in Kernel uses manual constructor injection and a Node HTTP
composition root, not NestJS. ADR-0039 already records abandonment of the
NestJS-per-package layout. Current architecture documents still described the
original design as implementation. At main commit `19501ce7e7`, architecture
fitness also correctly rejected provider-specific RTC speech calls in Core.

## Decision

Keep the existing TypeScript/Node modular monolith and explicit service
interfaces. `buildKernel` in `apps/core/src/kernel/lifecycle/kernel.ts` composes
the services. Framework migration is not required to enforce their ownership
boundaries. Node HTTP handles Core diagnostics and Model Gateway ingress.
The existing architecture fitness gate remains mandatory and unchanged.

All cloud speech provider calls, keys, model defaults and provider PCM conversion
belong in `apps/gateway/src/adapters/openai-speech.ts`. Core calls authenticated
`POST /v1/speech` using the shared provider-neutral speech contract. Gateway
checks audio consent, validates bounded input, propagates cancellation, bounds
provider time and redacts errors. Local speech never uses this endpoint.

The trusted `/rtc/join` path still defaults to local speech. Explicit cloud
selection is session-scoped; the authenticated Kernel agent propagates it as
`cloudConsent: true`. This flag is an assertion by the trusted Kernel, not a
new independently signed user-consent credential. The Gateway bearer must stay
private. Cloud text-inference permission alone does not grant audio consent.

## Consequences and limits

Provider keys and `JARVIS_RTC_ASR_MODEL` / `JARVIS_RTC_TTS_MODEL` are needed only
by Gateway speech implementation. Core needs `JARVIS_MODEL_GATEWAY_URL` and
`JARVIS_GATEWAY_TOKEN`. Missing provider configuration fails at the Gateway;
room admission no longer requires a provider key in Core's environment.

Existing 25-second provider deadlines, bounded utterances, transcript/text
limits and mono 16 kHz PCM playback are preserved. Odd-byte provider PCM is
rejected rather than read as incomplete int16 samples. No UI changes apply.

HTTP/provider fixtures verify contracts, not vendor availability, speech quality
or physical microphone playback. See [release baseline](../RELEASE_BASELINE.md)
for verification commands and remaining live scenarios.

## Reversal difficulty

Low mechanically; moving provider calls back into Core violates ADR-0010 and
must continue to fail architecture fitness.
