# JARVIS · Resonance

Baseline `cab8505` → this pass. Mark 42 untouched at `9c1b880`. No push, no merge, no
secret read, no paid request, no microphone opened, no model downloaded.

The system can hold a **single-turn cloud conversation** the moment a key exists. It
cannot yet hold a multi-turn cloud conversation, by design. Everything below is measured
or read from source; nothing is inferred from a screenshot.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| GATEWAY_CONFIGURATION | **PARTIAL** | Every variable and its semantics verified in source, and the launcher path was exercised — but the gateway itself was never started, because no key exists. |
| FIRST_TURN_INFERENCE | **BLOCKED_EXTERNAL** | No provider credential, no spending authorisation. Nothing attempted. |
| CONVERSATION_CONTINUITY | **BLOCKED_EXTERNAL** | Two independent blockers: no model at all, and any continuing conversation is forced local by policy. |
| RESTART_PERSISTENCE | **IMPLEMENTED_TESTED** | The turn store is durable (`experience.conversation_turns`); not exercised with a real turn. |
| LOCAL_MODEL_READINESS | **BLOCKED_EXTERNAL** | Runtime installed, zero models, no server, 754 MB RAM free. |
| CLOUD_PRIVACY_POLICY | **IMPLEMENTED_TESTED** | Existing ceiling extracted into a pure, tested function; seven adversarial cases. No new authority surface. |
| VOICE_READINESS | **BLOCKED_EXTERNAL** | LiveKit container runs, but the config it mounts does not exist and the Kernel env is unset. |
| PHYSICAL_MICROPHONE | **NOT_ATTEMPTED** | Requires a human gesture. Correctly not attempted. |
| RESPONSE_PRESENTATION | **IMPLEMENTED_TESTED** | The shipped component's rendering is asserted by test, and the built bundle is verified to contain the formatter. |
| DEAD_LETTER_INTEGRITY | **PARTIAL** | Backlog is now visible as durable, but the schema cannot represent resolution, so "resolved" cannot be proven. |
| EVIDENCE_HYGIENE | **PARTIAL** | Text artifacts are clean; one historical image was replaced; the remaining images cannot be OCR-verified in this environment. |

## A — Exact operator configuration

Verified against `apps/core/src/runtime/config.ts`, `apps/gateway/src/main.ts`,
`apps/gateway/src/adapters/openai-compatible.ts` and the cognition path. There are
**five** variables, not three, and one of them is the one that silently breaks routing.

| Variable | Process | Requirement |
|---|---|---|
| `OPENROUTER_API_KEY` | gateway | Presence registers the adapter. |
| `JARVIS_OPENROUTER_MODEL` | gateway | Required with the key. Becomes the registry id *and* the upstream model string. |
| `JARVIS_PREFERRED_MODELS` | kernel | Routing preference. Must contain that same id or routing finds no candidate. |
| `JARVIS_MODEL_CLOUD_ALLOWED` | kernel | `false` by default; set to `1` for the session. |
| `JARVIS_MODEL_GATEWAY_URL` | kernel | Defaults to `http://127.0.0.1:7430`. Only needed if the port differs. |
| `JARVIS_GATEWAY_TOKEN` | both | Shared secret for the Kernel→Gateway hop. Defaults: gateway `dev-gateway-token`, kernel the same value. Must match exactly; a non-loopback bind with the default is refused at boot. |

`scripts/jarvis-up.ps1` sets the last three correctly (loopback URLs, matching token,
cloud flag conditional on the key) and does not need editing.

**PowerShell 5.1 secure entry** (my previous instruction used a PowerShell 7-only flag —
that would have failed on this machine):

```powershell
cd D:\Projects\Jarvis-Sentience

$secure = Read-Host -AsSecureString "OpenRouter runtime key"
$env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:JARVIS_OPENROUTER_MODEL  = 'deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS  = $env:JARVIS_OPENROUTER_MODEL

powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1

# verify, without spending anything:
Invoke-RestMethod http://127.0.0.1:7430/health
Invoke-RestMethod http://127.0.0.1:7420/diagnostics |
  Select-Object ok, @{n='deps';e={$_.dependencies.name -join ','}}
```

Model allowlisting: there is none — the gateway passes any id through, so the model is
whatever OpenRouter accepts, and `/models` health surfaces a bad id at boot. Provider
selection: the registry, then the Kernel's locality/cloud policy, then the caller's
preference list. Gateway authentication: bearer token, loopback-only unless the token is
replaced.

## B — Conversation privacy

Full analysis and threat model in
[`architecture/ADR-003-conversation-privacy.md`](architecture/ADR-003-conversation-privacy.md).

Summary: the safeguard is **content-derived**, not conversation-derived.
`context.compile` returns `maxPrivacyClass`; SENSITIVE and RESTRICTED force
`locality: 'local'` and `cloudAllowed: false`; RESTRICTED with no local model refuses to
route at all. Business answers are written to `cognition.runs` as `privacy_class =
'RESTRICTED'`, so business history is already classified at the point it is produced.

The gap is durability: `experience.conversation_turns` has no privacy column, no grant
table, no revocation. A per-conversation cloud grant therefore cannot be evaluated — so
none was implemented. The current local-only rule is untouched.

**One bounded implementation was made**: the routing decision was extracted into
`routingPolicy()` with seven adversarial tests (a caller cannot pull a SENSITIVE context
to cloud; global cloud ban is never overridden; RESTRICTED without a local model fails
closed; SENSITIVE without a local model still routes locally rather than being refused).
The logic is identical to what the orchestrator already did — it is now testable and
cannot diverge from the call site.

## C — Local model feasibility (measured)

| Measurement | Value |
|---|---|
| CPU | Snapdragon X Plus X1P42100 (Oryon), ARM64 |
| RAM | 15.97 GB total · **754 MB available** |
| Disk | C: 6.3 GB free (98 % used) · D: 660 GB free |
| Installed runtime | LM Studio CLI (`~/.lmstudio/bin/lms`, commit `71bd99c`) |
| Server | **OFF**; no endpoint answered on 11434/1234/8080/8000/5000/8081 |
| Downloaded models | **none** (`~/.lmstudio/models` is empty) |

Assessment: nothing is ready. A 7–8B model at Q4 needs ~5 GB resident; with 754 MB free
the machine would page continuously. The Adreno X1-45 has no verified backend here, and
pretending otherwise would produce a benchmark that contradicts itself. **Local inference
is unverified and, right now, impractical.**

Smallest practical configuration, if you want continuity without cloud:

1. Free memory first (Docker Desktop, browser, editor) — target ≥8 GB available.
2. Download a 3–4B instruct model in Q4 to **D:**, not C: (C: has 6.3 GB).
3. Serve it OpenAI-compatibly and register it on the gateway with
   `JARVIS_LOCAL_MODEL_URL` (and `JARVIS_LOCAL_MODEL` for the id); the gateway registers it
   with locality `local`, which is what the privacy ceiling requires.
4. Verify with a single local turn; treat throughput and tool-calling as unverified until
   observed. A 3B model will produce weaker proposals than the cloud model — that is the
   trade the privacy rule makes explicit.

## D — Bounded conversation test (prepared, not executed)

Disposable conversation, synthetic content, no business data:

| Turn | Input | Proves |
|---|---|---|
| 1 | "Hello Jarvis. Introduce yourself in one sentence." | Admission, provider selection, policy-approved context, one inference, persisted turn + answer. |
| 2 | "For this test, the project codename is Aurora." | Continuity is *attempted*; with a cloud model this must fail closed (forced local) — that failure is the evidence for §B. |
| 3 | "What project codename did I just give you?" | Continuity: only meaningful with a local model, where turns 1–3 must complete and turn 3 must answer "Aurora". |

Verification per turn, none of which an HTTP 200 substitutes for:

```sql
select turn_id, conversation_id, status, privacy_class, left(input,40), left(answer,60)
from experience.conversation_turns order by created_at desc limit 5;
select request_id, model_id, status, privacy_class from cognition.runs order by started_at desc limit 3;
```

Restart persistence is a separate claim: stop only the Kernel, restart it, resume the
same `conversation_id`, and confirm turn 3 still answers correctly. Long-term memory is
not qualified by any of this and no memory is written by the test.

## E — Inference resource controls (implemented)

- Kernel ceiling is now `MAX_COGNITION_OUTPUT = 2000` in one place, with
  `boundedOutput(requested)`: a client may ask for **less**, never more; nonsense
  (`NaN`, `0`, negative, infinity) is treated as "no preference", not as an error;
  fractional values floor.
- `DesktopCognitionCommand` carries an optional `maxOutputTokens`, forwarded by the
  desktop gateway and clamped in the orchestrator. No client can lift the ceiling.
- Existing controls unchanged: `maxLatencyMs` (120 s default at the gateway),
  `maxCost`, no automatic paid fallback beyond declared routing order, `finish_reason:
  length` raises an error rather than returning a truncated answer, `usage.cost` and key
  remaining balance recorded per call.
- Tests: 5 for the budget policy (including "1,000,000 ⇒ 2000").

Not claimed: per-conversation spending caps and tool-iteration limits were not audited in
this pass, so they are neither confirmed nor added.

## F — Response presentation, verified rather than asserted

The raw JSON in the previous screenshot was **the pre-fix capture** (commit `50e5d88`),
not a stale export or a formatter bypass. Evidence:

- `out/_next/static/chunks/app/page.js` contains the formatter's strings ("as of ",
  "fields:", "records"), and `out/_next/static/css/*.css` contains `presence-evidence`:
  the shipped export is the new one.
- `presence-answer.render.test.ts` renders the **shipped component** with synthetic
  records and asserts: prose stays prose, evidence is a collapsed `<details>`, the JSON
  never appears outside `<pre>`, and a plain answer is unchanged.
- The screenshot was replaced in `cab8505` with a capture taken after removing the
  response surface from the DOM.

Live observation with a real model answer remains blocked with the rest of inference.

## G — Dead-letter integrity

Schema (`0002_event_store.sql`): `id, consumer, event_id, event jsonb, attempts,
last_error, created_at`. There is **no acknowledgement, no replay path, no resolution,
no expiry** anywhere in the code — `dead_letter` is referenced only by the sink and the
relay.

Measured backlog (aggregates only, no payloads read):

| Consumer | Count | Window | Causes |
|---|---|---|---|
| `outbox-relay` | 1041 | 2026-09-08 → **2026-10-08** | `bus unhealthy` 1008 · `canonical event has no JetStream owner` 32 · `write CONNECT_TIMEOUT localhost:5433` 1 |

Honest distinctions now in `/diagnostics.events`:

- `deadLettered` — lifetime total (1041).
- `deadLetteredSinceStart` — what this process observed (0).
- `deadLetteredUnresolved` — the durable backlog, which **equals the lifetime total** because
  nothing can be marked resolved. Reported so a restart cannot hide it; deliberately not
  part of `ok`, because a health endpoint must not fail forever on history.
- "Resolved historical incidents": **not representable**. The schema cannot express
  resolution, so none is claimed.

Operational impact today: nothing has been dead-lettered since 2026-10-08, `outboxPending`
is 0 and the fabric is HEALTHY — but 32 events of a *live* event type with no JetStream
owner are a topology defect that will recur. No event was replayed and nothing was deleted.

Operator options (not performed): add resolution columns (`resolved_at, resolution`), then a
separately-approved replay tool; or fix the missing JetStream ownership and archive the
old rows. Both need approval because they touch durable event data.

## H — Evidence hygiene

Scanned all 25 tracked artifacts under `docs/evidence` for emails, invoice-like ids,
bearer tokens, API-key shapes, private addresses and currency amounts: **no matches in any
text artifact.** The only URL matches are loopback addresses (`127.0.0.1:PORT`) inside
qualification records, which are local development endpoints, not internal hostnames.

Images: 16 tracked PNGs. The one that carried business records is
`docs/evidence/sentience-first-contact/live-connected-standby.png` — introduced in
`50e5d88`, replaced in `cab8505`. Git history is unchanged, per instruction. The other
images are demo/fixture renders (synthetic data) or disconnected states, but they cannot be
OCR-verified in this environment (managed Chromium is permission-blocked), so they are
**unverified rather than certified clean**.

Sanitisation plan if you want the history clean rather than just the tip: a
`git filter-repo` pass over that single path — destructive, needs its own approval, and
would rewrite every SHA.

## I — Voice configuration

Verified variables and semantics (`kernel.ts`): `JARVIS_LIVEKIT_URL` (default
`ws://127.0.0.1:7880`), `JARVIS_LIVEKIT_API_KEY`, `JARVIS_LIVEKIT_API_SECRET`. Without
the key pair the RTC service is not constructed at all and `/diagnostics` reports
`rtc OFFLINE`. Admission additionally requires a `voice.write` scope, a node whose trust
tier is `kernel-local` or `owned-secure`, and a node type other than `mobile`/`display`.

Infrastructure: `infrastructure/docker/rtc.compose.yml` runs
`livekit/livekit-server:v1.9.12`, loopback-bound (`127.0.0.1:7880`, `7881`,
`7882/udp`). The container is up, and its own logs show it previously served real rooms
(`jarvis-…`, `surface-…`, `agent-…`) — so the path works on this machine. But the compose
file mounts `artifacts/local-runtime/pki/livekit.yaml`, and **that file does not exist**,
and no script generates it (`scripts/node-pki.mjs` only makes node certificates). The
running container therefore holds no usable key pair.

Operator sequence (each prerequisite independent):

1. Create `artifacts/local-runtime/pki/livekit.yaml` with a `keys:` entry (api key +
   secret) and logging; keep it out of git. Needs your approval as a new local file.
2. Restart the RTC compose stack; confirm the container stays healthy.
3. Export the same key/secret as `JARVIS_LIVEKIT_API_KEY` / `JARVIS_LIVEKIT_API_SECRET`
   (and `JARVIS_LIVEKIT_URL` if not the default) into the Kernel's shell only.
4. Restart the Kernel; `/diagnostics` must report `rtc HEALTHY`.
5. Open presence, press the microphone, accept the browser prompt.
6. Speak one synthetic sentence ("Jarvis, this is a microphone check").
7. Observe the orb envelope move with your voice — not before.
8. Confirm a transcript appears; confirm audio playback if TTS is configured.
9. Stop the microphone; confirm the browser's recording indicator clears.
10. Confirm the state returns to STANDBY and the session is released.

No audio leaves the machine: LiveKit is local, recognition and speech are in-browser
workers. Nothing in steps 5–9 was performed here.

## J — Storage and reliability

| Item | Measured |
|---|---|
| C: | 216 GB total, **6.3 GB free (98 %)** — it fell from 11.8 GB during this session's builds |
| D: | 932 GB total, 660 GB free |
| Docker root | `/var/lib/docker` inside the WSL2 VM (overlaydfs), volume `jarvis-mk43_pgdata` |
| Postgres checkpoints | 14 since start: write 578 s, sync 152 s cumulative; recent ones 84–185 buffers in 8–27 s |
| Volume fsync probe | 45.6 MB/s (64 MB, `conv=fdatasync`) |
| PostgreSQL config | `checkpoint_timeout=300`, `max_wal_size=1GB`, `completion_target=0.9`, `fsync=on`, `full_page_writes=on`, `shared_buffers=16MB` |

Measured: write latency is the anomaly, the volume is not a bind mount, and the
configuration is default. **Suspected, not proven:** the Docker VM disk sits on the
nearly-full system volume and the host's storage is the bottleneck — I could not confirm
the VHDX path with read-only tools, so it stays a hypothesis.

Minimum safe recommendations: free space on C: (or relocate the Docker disk, which is a
Docker Desktop setting change and needs approval), re-run the fsync probe afterwards, and
leave PostgreSQL's durability settings alone. Nothing was moved, cleaned or tuned.

## Verification

| Command | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` | pass |
| `vitest run apps/desktop/src` | **186 pass** (4 new render tests) |
| `vitest run apps/core/src/kernel/cognition` | **54 pass** (12 new) |
| `vitest run apps/core/src/kernel/event-fabric` | 8 pass |
| `pnpm lint` | clean |
| `node scripts/run-gate.mjs fitness` | 17/17 |
| `pnpm build:desktop` (live + demo) | pass |
| bundle inspection | formatter strings present in the shipped export |
| `scripts/jarvis-up.ps1 -Check` | pass |

## What actually unblocks a conversation

1. A key, three variables, `scripts\jarvis-up.ps1` → single-turn cloud conversation.
2. A local model (`JARVIS_LOCAL_MODEL_URL`) → multi-turn continuity, inside the privacy
   boundary that already exists.
3. A `livekit.yaml` with a key pair + the two env vars → voice.
