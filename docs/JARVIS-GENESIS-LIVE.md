# JARVIS · Genesis Live — operator runbook

Baseline `ebefabe` → this pass. Mark 42 untouched at `9c1b880`; V2 untouched. No paid
inference, no microphone, no credential read, no model download.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| PRIVACY_ACCEPTANCE | **IMPLEMENTED_TESTED** | 21 new adversarial tests, including an executable concurrency case; one real gap found and fixed (below). |
| GATEWAY_READINESS | **PARTIAL** | Configuration verified end to end; a real launcher defect found and fixed; no key, so no live gateway. |
| FIRST_TURN_INFERENCE | **BLOCKED_EXTERNAL** | No key, no authorisation. |
| MULTI_TURN_INFERENCE | **BLOCKED_EXTERNAL** | Same. |
| RESTART_CONTINUITY | **BLOCKED_EXTERNAL** | Needs a first conversation to continue. |
| GRANT_REVOCATION | **IMPLEMENTED_TESTED** | Revocation now re-checked at dispatch (fix below); revocation test is executable. |
| RTC_CONFIGURATION | **IMPLEMENTED_TESTED** | Generator written, 12 tests; not run against a live service (needs operator invocation). |
| PHYSICAL_MICROPHONE | **NOT_ATTEMPTED** | Requires your gesture. |
| SPEECH_RECOGNITION | **BLOCKED_EXTERNAL** | **No ASR implementation exists in the repository** — only an interface. |
| SPEECH_PLAYBACK | **IMPLEMENTED_TESTED** | In-browser Kokoro TTS (13 voices); not exercised with real audio. |
| FULL_CONVERSATIONAL_LOOP | **NOT_ATTEMPTED** | Depends on all of the above. |

## A — Pre-dispatch security review

### Defect found and fixed

**The authorisation was decided at turn acceptance, not at dispatch.** A grant revoked
while the context was compiling would still have been dispatched, because nothing re-read
it. Fixed: `CognitionRequest.authorisation` carries a pointer to the grant, and the
orchestrator calls `verifyAuthorisation` immediately before `runtime.invoke`, which
re-reads the row and refuses on revoked, expired, wrong provider, wrong conversation,
wrong policy version, or ceiling above cloud. The Kernel supplies that verifier from
Postgres.

This is the difference between "sequential code that probably behaves" and a boundary that
holds. It is now covered by an executable test: the grant is live on the first read, revoked
between acceptance and dispatch, and the second read refuses.

### What the review confirmed

| Surface | Finding |
|---|---|
| Request metadata | `prompt()` sends instruction, constraints, context, examples only. No principal, correlation id, privacy class, provider or model preference reaches the provider. Asserted by test. |
| System prompt | Fixed text about the JSON contract; it makes no claim about permitted data and does not mention privacy. Asserted. |
| Eligible conversation history | Only turns created after the grant, `<= ceiling`, `CLOUD_PERMITTED`. Pre-grant history is excluded, not truncated into the prompt. |
| Long-term memory | Not reached on the cloud path: the compiled context is the ceiling-capped package, and evidence is only read when an `evidenceRef` exists. Asserted (`evidence` not called without a reference). |
| Business tool results | Business answers are produced by the Kernel and recorded `RESTRICTED`; they never enter a cloud prompt. The compiler refuses a package above the ceiling rather than trimming it — asserted against a sentinel. |
| Attachments/metadata | No attachment path exists in the desktop cognition command. |
| Output limits | Client may request less, never more; nonsense is treated as no preference. 5 tests. |
| Self-authorisation | Grants are created only by a `desktop.write` command from a `kernel-local`/`owned-secure` session, bound to the active principal. Model output never reaches the grant table. |
| Provider substitution | `requiredProvider` is a hard registry filter that throws `NO_ROUTE`; 6 tests. OpenRouter is itself a router, so "provider" here means OpenRouter — **no underlying-inference-provider guarantee is claimed.** |

### Sentinel test

`cloud-ceiling.test.ts` puts `SENTINEL-RESTRICTED-7f3a` in RESTRICTED evidence and asserts
the compiler refuses the package rather than including, or silently trimming, it.
`payload.test.ts` captures the actual outbound HTTP body from the adapter and asserts the
sentinel and all request metadata are absent.

## B — Gateway configuration, and a launcher defect

Verified variable names and consumers: `OPENROUTER_API_KEY` + `JARVIS_OPENROUTER_MODEL`
(gateway; the model string is the registry id **and** the upstream model),
`JARVIS_PREFERRED_MODELS` (kernel routing), `JARVIS_MODEL_CLOUD_ALLOWED` (kernel gate),
`JARVIS_MODEL_GATEWAY_URL` and `JARVIS_GATEWAY_TOKEN` (the Kernel→Gateway hop).

**Finding:** a running process does not inherit a new environment. Starting the launcher
again after setting a key would previously have left the old Kernel and Gateway running on
the old configuration while a second pair failed to bind. The launcher now checks ports
7420/7430 before starting and refuses with the owning pid:

```
[stop] port 7420 is already in use (pid 9888) - stop it first, then rerun, so the new
       configuration is actually applied
```

Verified by running it against the Kernel I had started manually. The key is never an
argument, never printed, and never written to a tracked file.

## C — Accepting a real conversation (you run this)

1. **Start.** `powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1`
2. **Key, in the same shell**, PowerShell 5.1:

```powershell
$secure = Read-Host -AsSecureString "OpenRouter runtime key (JARVIS-RUNTIME, $1 cap)"
$env:OPENROUTER_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:JARVIS_OPENROUTER_MODEL='deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS=$env:JARVIS_OPENROUTER_MODEL
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1
```

3. **Open presence:** <http://127.0.0.1:4300/?mode=presence> (the launcher opens it).
4. **Consent:** press `ALLOW CLOUD` on the privacy chip. It says `CLOUD · openrouter` and
   the Kernel now holds a grant for this conversation.
5. **Four turns:**

| # | Say |
|---|---|
| 1 | "Hello Jarvis. Introduce yourself in one sentence." |
| 2 | "The fictional project codename for this conversation is Aurora." |
| 3 | "What was the fictional project codename?" |
| 4 | "Summarise this conversation in one sentence." |

6. **Evidence** (read-only queries):

```sql
select turn_id, conversation_id, status, privacy_class, privacy_regime, left(answer,60)
  from experience.conversation_turns order by created_at desc limit 4;
select grant_id, provider, model, ceiling, revoked_at from experience.conversation_grants;
select request_id, model_id, privacy_class, usage_observability->>'costEstimate' cost,
       routing_observability->>'selectedModelId' routed
  from cognition.runs order by started_at desc limit 4;
```

Expected: four turns, `privacy_class` INTERNAL, `privacy_regime` CLOUD_PERMITTED, one grant
row, `model_id = deepseek/deepseek-v4.1-flash-1017`, non-null cost.

**Output ceiling:** the presence UI does not expose a per-turn token field; the
authoritative ceiling is 2000 and a client may only lower it. To exercise 256 exactly, send
the command directly with `"maxOutputTokens": 256` — the UI path will not do it, and this
is stated rather than faked.

7. **Restart continuity:** stop the Kernel (not the containers), start it again, send
   "What was the codename?" in the same conversation. The grant survives; the answer must
   still be Aurora.
8. **Revocation:** press `MAKE PRIVATE`, then send another turn. The Kernel refuses cloud
   and either runs locally or fails with a privacy/locality error. It must never silently
   reach OpenRouter.

## D — LiveKit configuration

```powershell
cd D:\Projects\Jarvis-Sentience
node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs" rtc:config
```

Generates, once, and refuses to overwrite:
`artifacts/local-runtime/pki/livekit.yaml` and `livekit.env` (both git-ignored; `icacls`
inheritance removed and the current user granted, in addition to `chmod 0600` — Windows
NTFS ignores POSIX modes, so the ACL is what actually restricts).

The launcher sources `livekit.env` when present, starts the RTC compose service, and says
`rtc: local LiveKit credentials loaded (values not shown)`. It never prints the values.

Then: `Invoke-RestMethod http://127.0.0.1:7420/diagnostics | Select-Object -Expand dependencies | Where-Object name -eq rtc` must say `HEALTHY`.

## E — Voice: what is actually there

- **TTS: implemented, in-browser.** `kokoro-js` (`KokoroTTS`) in a web worker, 13 voices,
  no external service. Not yet exercised with real playback.
- **ASR: not implemented.** `apps/voice` defines `AsrAdapter.transcribe(...)` and the voice
  engine consumes it, but **no implementation exists in this repository** — the only files
  referencing it are the interface and the engine. So a transcript cannot be produced today
  regardless of LiveKit's health. This is the real voice blocker, and it is larger than the
  missing `livekit.yaml`.
- Writing an ASR adapter (e.g. whisper.cpp or Vosk behind the existing interface) needs a
  model on disk and your approval. Nothing was downloaded.

Qualification sequence once both exist: press the microphone → permission → track acquired →
session admitted → speak → envelope moves the orb → transcript appears → response → playback
drives the orb → press stop → indicators clear and tracks are released. Every step is
observable in the UI; none is claimed here.

## F — Response presentation

Unchanged and verified: the shipped component renders prose as prose, structured evidence
collapsed, JSON never outside `<pre>`, plain answers untouched (4 render tests), and the
production export contains the formatter. Privacy chip has a visible focus ring and a
disabled state; unavailable provider is reported, not implied.

## G — Storage

C: **6.3 GB free (98 %)**; D: **660 GB free**; RAM 1,575 MB available at measurement.
Docker confirmed on D: (121 GB under `D:\Docker\wsl`). Cache sizes could not be measured
(directory walks exceeded the timeout), so no ranking is claimed.

Reversible recommendations, none applied:

```powershell
# pnpm content store (global setting; existing node_modules must be reinstalled to benefit)
pnpm config set store-dir D:\DevCache\pnpm
# npm cache
npm config set cache D:\DevCache\npm --global
```

Do not move the Corepack cache: the pinned invocation
`node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs"` depends on it.
Freeing space on C: matters more than any of these.

## H — Evidence and publication

Known affected artifact: `docs/evidence/sentience-first-contact/live-connected-standby.png`,
introduced in `50e5d88`, replaced in `cab8505`. It remains in local history. No other text
artifact contains customer, invoice, credential or private-conversation data (scan of all 25
tracked artifacts); the remaining 15 images are synthetic or disconnected-state captures but
are **unverified** rather than certified, because OCR is unavailable here.

Publication strategy for an independently reviewed branch, when you want it: export the
tree (`git archive`), drop that one image from the export, and push the export — history
stays intact locally, and nothing private is published. Destructive `filter-repo` is
possible but rewrites every SHA and needs its own approval.

## I — Verification

| Command | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` | pass |
| `vitest run apps/desktop/src apps/core/src apps/gateway/src` | **571 pass** (26 new) |
| `pnpm lint` | clean |
| `node scripts/run-gate.mjs fitness` | 17/17 |
| `pnpm build:desktop` | pass |
| `scripts/jarvis-up.ps1 -Check` | pass |
| live `/diagnostics` | `ok: true`, `rtc` OFFLINE, `model-gateway` OFFLINE |

New tests: 12 dispatch-authorisation (incl. revocation inside the window), 4 cloud-ceiling
sentinel, 5 outbound payload, 5 LiveKit config writing.

## J — Remaining blockers

1. OpenRouter runtime key + your authorisation for the four-turn test.
2. An ASR implementation for voice (no model bundled, none downloadable here).
3. `rtc:config` run once (yours to invoke).
4. 6.3 GB free on C:.
