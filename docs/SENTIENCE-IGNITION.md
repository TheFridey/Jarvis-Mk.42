# SENTIENCE · Ignition

Status: **the assistant is operational as a local system; it is not yet a
conversation.** Everything that can be built without a provider key, a LiveKit
credential or a human at a microphone is built, measured and committed. The three
remaining gates are configuration and authorisation, not code.

Baseline `50e5d88` → this pass. Original Mark 42 untouched at `9c1b880`. No push, no
merge, no production contact, no secret read, no paid request.

## Completion classifications

| Workstream | Result | Basis |
|---|---|---|
| KERNEL_CONNECTION | **VERIFIED_LIVE** | Kernel 0.43.0 on `127.0.0.1:7420`, all dependencies HEALTHY, `ok: true` after the fix below. |
| GATEWAY_CONNECTION | **BLOCKED_EXTERNAL** | Gateway source and wiring verified; no provider key in this environment, so it was not started. |
| MODEL_INFERENCE | **BLOCKED_EXTERNAL** | No credential, no spending approval. Nothing was attempted. |
| CONVERSATION_PERSISTENCE | **IMPLEMENTED_TESTED** | Persistence path inspected (`experience.conversation_turns`); exercised only by existing tests, not by a live turn. |
| CONVERSATIONAL_CONTINUITY | **BLOCKED_EXTERNAL** | Blocked *twice*: needs a model, and by design a continuing conversation is forced local (see §D). |
| PHYSICAL_MICROPHONE | **NOT_ATTEMPTED** | Requires the operator to press the control and grant permission. Correctly not attempted. |
| SPEECH_RECOGNITION | **BLOCKED_EXTERNAL** | Needs RTC + microphone. |
| VOICE_PLAYBACK | **BLOCKED_EXTERNAL** | Needs RTC + a response. |
| AUDIO_REACTIVE_ORB | **IMPLEMENTED_TESTED** | Orb follows observed `voiceAudio` only; unexercised by real audio. |
| FULL_CONVERSATIONAL_LOOP | **NOT_ATTEMPTED** | Depends on all of the above. |
| WORK_STATE_INTEGRITY | **VERIFIED_LIVE** | New four-way classification, 9 adversarial tests, plus a Kernel fix proven against the live process. |
| DATABASE_RELIABILITY | **PARTIAL** | Measured, reproducible evidence gathered; the cause is narrowed to host storage, not PostgreSQL configuration. No tuning applied. |
| OPERATOR_STARTUP | **VERIFIED_LIVE** | `scripts/jarvis-up.ps1` actually started this stack, reached `healthz 200`, and was re-run after a code change. |

## A — Provider configuration, verified against the source

The names in the brief are almost right, but the semantics are not what the names
suggest. Verified by reading `apps/gateway/src/main.ts`, `adapters/openai-compatible.ts`,
`gateway.ts`, `apps/core/src/runtime/config.ts` and the cognition path.

| Variable | Consumed by | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | gateway (`:16`) | Presence of the key *registers* the adapter. Unset ⇒ no OpenRouter model exists at all. |
| `JARVIS_OPENROUTER_MODEL` | gateway (`:17`) | **Required** when the key is set; the string is both the registry id and the exact `model` sent upstream. The gateway throws at boot if it is missing. |
| `JARVIS_PREFERRED_MODELS` | kernel (cognition orchestrator) | Routing preference list, default `gpt-6.1-sol`. **If this does not contain the registry id, routing finds no candidate and the turn fails before any request is made.** |
| `JARVIS_MODEL_CLOUD_ALLOWED` | kernel (`config.ts:117`) | Default `false`. Gates cloud locality for every request. |
| `JARVIS_GATEWAY_TOKEN` | gateway ingress guard | Must be non-default if the gateway ever binds beyond loopback; it refuses to start otherwise. |
| `NEXT_PUBLIC_JARVIS_PREFERRED_MODEL` | desktop build | Initial value of the UI's "Preferred inference model" field (default `gpt-6.1-sol`). The field is authoritative at runtime and is what presence sends. |

Adapter behaviour that matters for cost and honesty:

- `max_tokens` is `request.budget.maxOutput`; `temperature` is `0` unless the request
  is marked creative.
- Timeout is `budget.maxLatencyMs`, else **120 s**.
- `finish_reason: 'length'` raises `truncatedOutput` — a truncated answer is an error,
  never silently presented.
- `usage.cost` is recorded as `actualCost`; the adapter also queries
  `GET /key` (60 s cache) and reports `keyLimitUSD` / `keyRemainingUSD`, so a `$1` cap
  is visible from inside the system.
- The system prompt forces the JSON proposal contract. The model is an *advisor*:
  proposals are not execution, and no tool runs without the existing approval path.

**Model support:** `deepseek/deepseek-v4.1-flash-1017` is structurally supported — the
gateway passes any OpenRouter id through unchanged, with no allowlist. Validity is
whatever OpenRouter reports; `/models` health resolves it at boot.

**The 256-token cap is not supported per request.** `cognize` takes no budget
(`DesktopCognitionCommand` has no token field) and the orchestrator hardcodes
`maxOutput: 2000` for the agent call. The honest options are (a) cap spend with
OpenRouter's key limit — recommended, and it is enforced upstream, or (b) a contract
change to thread a per-request budget, which was not made in this pass because it
touches authority surfaces.

### Exact PowerShell procedure (operator runs this; no secret enters this conversation)

```powershell
cd D:\Projects\Jarvis-Sentience

# 1. The key goes into THIS shell only, from your password manager.
$env:OPENROUTER_API_KEY = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:JARVIS_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS = $env:JARVIS_OPENROUTER_MODEL

# 2. Start everything. The launcher detects the key, starts the gateway,
#    allows cloud for this session only, and opens presence.
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1

# 3. Confirm the gateway is advertising the model.
Invoke-RestMethod http://127.0.0.1:7430/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:7420/diagnostics | Select-Object -Expand dependencies |
  Where-Object name -eq 'model-gateway'
```

Set the UI's **Preferred inference model** to the same id if you changed it in a
previous session; the field, not the env var, is what the request carries.

## B — Gateway readiness

Not started: with no key the process either refuses (missing `JARVIS_OPENROUTER_MODEL`)
or registers no cloud model. Both are correct fail-closed behaviour and neither was
worked around. Everything a start would need was verified by reading the code path:
authenticated Kernel→Gateway hop via `JARVIS_GATEWAY_TOKEN`, loopback-only ingress
guard, provider availability via `GET /models`, model selection, timeout, output cap,
no automatic fallback beyond the declared routing order, spend accounting.

## C — First conversation: prepared, not executed

The exact test, ready to run the moment a key exists:

> **User:** "Hello Jarvis. Identify yourself and explain in one sentence what you are designed to do."

What to check, in order — an HTTP 200 is not success:

1. `experience.conversation_turns` gains a row with `status='running'` then `'completed'`,
   a `conversation_id`, the `input`, and a non-null `answer`.
2. `GET /desktop/snapshot` shows the turn in the Operating Picture, and presence moves
   THINKING → ROUTING → INFERENCE → RESPONDING.
3. The answer is prose (the formatter below keeps any structured evidence collapsed).
4. `usage.actualCost` and `keyRemainingUSD` are recorded on the model run.
5. Presence settles to STANDBY with no lingering "in flight" claim.

**Outbound context policy, inspected before authorising anything:** `cognize` assembles
context through the context compiler with the principal's domain scope; a first turn has
no conversation history, so the compiled context is the instruction itself plus
registered context for that principal. The smoke test asks nothing about business data,
which keeps the payload free of it. Note that the *companion* path can answer
business questions deterministically — that is a Kernel-side (`business.answer`) path and
does not call a model at all, which is why the ScaleSmiths payload in the First Contact
capture appeared without any inference.

## D — Continuity: an architectural finding, not a defect

`companion-service.converse` sets, for any turn that carries a `conversationId`:

```ts
...(mobile || (conversationId && !publicWeb)) ? { locality: 'local', cloudAllowed: false } : {}
```

A continuing conversation is therefore **forced local**, because its history may contain
private content. This is a deliberate privacy boundary, and it means a cloud model can
serve turn 1 but not turn 2. Consequences:

- Continuity is testable today only with a local model (`JARVIS_LOCAL_MODEL_URL`).
- The two-turn "codename Aurora" test is **BLOCKED_EXTERNAL** for that reason, in
  addition to needing a model at all.
- History is the last six completed turns of the same `conversation_id` in
  `experience.conversation_turns`. Durable long-term memory is a separate subsystem
  (Mnemosyne) and is **not** qualified by such a test; no memory was written.

## E — Voice infrastructure

- Kernel variables (verified names): `JARVIS_LIVEKIT_URL`, `JARVIS_LIVEKIT_API_KEY`,
  `JARVIS_LIVEKIT_API_SECRET`. Without them `/diagnostics` reports `rtc OFFLINE` and the
  presence microphone renders `VOICE UNAVAILABLE`.
- A LiveKit container from `infrastructure/docker/rtc.compose.yml` is already running on
  `7880/7881` (project `jarvis-mk43`), but it has no matching Jarvis credentials, so it is
  not the same session the Kernel expects. Do not assume "a LiveKit is up" means RTC works.
- Local speech: recognition and TTS are worker-based in the desktop (`neural-speech`,
  kokoro) and do not require an external service. Secure context is required for
  `getUserMedia`: `http://127.0.0.1` and `http://localhost` are treated as secure
  origins by Chromium; a LAN IP is not — use loopback.
- Device selection and the permission flow live in `use-rtc-session.ts`; permission
  denial is reported, not retried.

## F — Physical microphone: deliberately not attempted

Activating a microphone without the operator is exactly what the standing rules forbid,
and a captured microphone without a human speaking proves nothing. The qualifier is
written and waiting (15 steps in the Phase IV report). Nothing here is claimed.

## G — Human-readable responses

The raw JSON in the First Contact capture was **not** a model answer and not a rendering
bug in the strict sense: the Kernel's business path returns prose with the records it used
appended as `JSON.stringify(...)`, and the response surface rendered that string verbatim.

The bounded fix is presentation-only and deterministic:

- `apps/desktop/src/experience/presence/response-format.ts` splits an answer into prose
  and structured blocks, and describes a block **structurally only** — row count, field
  names, and the dates it contains ("as of X" for one, a range for several). It never
  summarises values, never invents, and keeps the original string (`source`) and the whole
  answer (`raw`).
- Structured evidence renders as a collapsed `<details>` with a pretty-printed body:
  `overflow-wrap: anywhere`, `max-height: 15rem`, scrollable, keyboard-focusable.
- Unbalanced braces stay literal so a malformed payload cannot swallow the rest of a reply.
- No second model call, no summarisation service.
- 9 tests, entirely synthetic records (`TEST-0001`), no business data.

**Evidence hygiene finding (reported, history not rewritten):** the committed First
Contact capture `live-connected-standby.png` had been taken while a live Kernel
notification was on screen, so the image contained real business records. It has been
replaced by a capture taken with the response surface removed from the DOM; the
qualification record now states whether such a surface was present
(`dismissedAnswer`). The accompanying `layout-audit-live-*.json` was checked and contains
no business content. No other committed artifact was found to carry live records.

## H — Work state integrity

The five-minute window from First Contact was a heuristic that could hide a real problem
("old therefore fixed"). It is replaced by a classification that requires evidence:

| Status | Meaning | Presentation |
|---|---|---|
| `active` | inside the 5-minute window, or undateable | `FAULT` |
| `unresolved` | old, no later success for that action, and the platform is not proven healthy | `DEGRADED` + *"Unresolved: X · FAILED at HH:MM. No successful retry observed."* |
| `outcome` | verification failed while the platform is healthy | `STANDBY` + *"Last verification: …"* |
| `historical` | a later success of the same action exists | `STANDBY` + *"Recovered since …"* |

Elapsed time alone never yields `historical`, and never hides an unresolved fault.
Recovery needs a later successful invocation of the same action, or a platform that
reports itself healthy.

**Kernel defect found and fixed (the long-term fix does belong upstream).**
`DiagnosticsService` computed `ok` as `dbOk && overall !== 'OFFLINE' && deadLettered === 0`,
where `deadLettered` is the *lifetime* count of `events.dead_letter`. One event lost at any
point in the past makes `/diagnostics` report `ok: false` forever — a cumulative counter
used as a health predicate, which is precisely the "historical failure presented as
current" class. Fix: `PgDeadLetterSink.countSince(iso)` (and the memory sink's equivalent)
plus `events.deadLetteredSinceStart`, with `ok` now judged on what this process observed;
the lifetime total remains in the report as history.

Verified live: before, `ok: false` with every subsystem HEALTHY; after restart,
`ok: true`, `deadLettered: 1041`, `deadLetteredSinceStart: 0`.

Nine adversarial tests added: old unresolved failure, old terminal failure, failure after
success, verified recovery, active work over a historical fault, missing/malformed
timestamps, disconnected observation, no ledger, and undateable fault.

## I — Database reliability: measured, not assumed

Evidence (read-only):

| Measurement | Value |
|---|---|
| Checkpoints since container start | 13 timed, 1 requested |
| Accumulated checkpoint write time | **578.4 s** |
| Accumulated checkpoint sync time | **151.8 s** |
| Recent individual checkpoints | 84–185 buffers written; `write=8.0–21.4 s`, `sync=0.2–7.0 s`, `total=9.6–27.6 s` |
| `fdatasync` throughput inside the volume | **45.6 MB/s** (64 MB in 1.47 s) |
| Volume | named volume `jarvis-mk43_pgdata` in `/var/lib/docker` (overlayfs, WSL2 ext4) — **not** a Windows bind mount |
| Database size | 48 MB |
| Host free space | C: 11.8 GB free of 216 GB (95 % used); D: 661 GB free |
| Configuration | `checkpoint_timeout=300s`, `max_wal_size=1GB`, `completion_target=0.9`, `fsync=on`, `full_page_writes=on`, `shared_buffers=16MB` |

Interpretation, bounded by the evidence:

- Writing under 200 buffers — roughly 1.6 MB — taking 8–21 s is not explainable by
  PostgreSQL configuration at this data size, and the volume is not a FUSE bind mount,
  so Windows file-sharing is not the mechanism either.
- 45.6 MB/s for a synchronous 64 MB write on ext4 is the anomaly, and it is the same
  storage the checkpoints fsync to. The 431 s event is the pathological end of that
  distribution, not a different phenomenon.
- No tuning was applied. `fsync`, `full_page_writes` and `synchronous_commit` were left
  alone deliberately.
- The projector's behaviour during the stall was consistent with backpressure: retries
  are bounded and it recovered on its own without losing state.

Operator actions, in order of value-per-risk: free space on C: (or move the Docker data
disk to D:, which has 661 GB free), then re-measure with the same probe (`dd … conv=fdatasync`
should exceed 200 MB/s), then — only if it is still slow — review the container's CPU/memory
share. Do not reduce `checkpoint_timeout` to "fix" slow writes; that makes it worse.

## J — One-step startup

`scripts/jarvis-up.ps1` (ASCII-only; PowerShell 5.1 compatible). It:

- checks node, the pinned pnpm, and the Docker engine, and says exactly what failed;
- starts only `postgres`, `redis`, `nats` from the repository's own compose file and waits
  for *healthy*, not merely "started";
- runs migrations (with `JARVIS_DB_URL` set to `127.0.0.1`, because `localhost` resolves
  to `::1` on this host and times out — the bug that broke the first run of this script);
- starts the gateway **only** if a provider key is present, and then starts the kernel with
  `JARVIS_MODEL_CLOUD_ALLOWED=1`; otherwise it reports inference unavailable and runs with
  cloud disabled;
- waits for `healthz`, starts presence bound to `127.0.0.1:4300` (Next binds `::1` only
  otherwise), opens it, and writes `.logs/jarvis-up.pids.json`;
- reports RTC as unavailable when LiveKit credentials are absent;
- never prints a secret, never sends a request, never opens a microphone;
- `-Check` verifies without starting anything; `-Down` stops tracked processes and the data
  plane, keeping volumes.

Verified: `-Check` passes; a full run brought the Kernel up to `healthz 200` and
`ok: true`; the first run's migration failure was a real order-of-operations bug in my own
script and is fixed.

Not done, by design: no service registration, no scheduled task, no change to deployment
behaviour.

## Visual polish

Only the observed issues were touched: the response/approval surfaces keep the Phase IV
opaque treatment, and the new evidence block uses the same platinum/gold palette with a
visible focus ring. The nucleus was left alone — a "flatter" nucleus is a taste judgement,
not a defect, and changing it would invalidate the measured GPU numbers for no functional
gain. Quality tiers, the command centre and frame pacing are unchanged.

## Verification

| Command | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` | pass (monorepo) |
| `vitest run apps/desktop/src` | **182 pass** |
| `vitest run apps/core/src/kernel/event-fabric` | 8 pass (1 new) |
| `pnpm lint` | clean |
| `node scripts/run-gate.mjs fitness` | *see commit* |
| `pnpm build:desktop` (live) | pass |
| demo build | pass |
| `node scripts/inspect-presence.mjs` | no overlap / overflow / clipping |
| `node scripts/qualify-presence.mjs` (live, hardware) | record committed |
| `scripts/jarvis-up.ps1 -Check` | pass, nothing started |
| live `/diagnostics` | `ok: true`, 8 dependencies, 2 optional OFFLINE |

## What is still missing, and exactly what unblocks it

1. **A key.** `$env:OPENROUTER_API_KEY` + `JARVIS_OPENROUTER_MODEL` +
   `JARVIS_PREFERRED_MODELS`, then `scripts\jarvis-up.ps1` → run the §C test once. That
   moves GATEWAY_CONNECTION and MODEL_INFERENCE to VERIFIED_LIVE and gives the first real
   conversation.
2. **A local model** (any OpenAI-compatible endpoint) for continuity, because turn 2 is
   forced local by design. `JARVIS_LOCAL_MODEL_URL` + `JARVIS_LOCAL_MODEL`.
3. **LiveKit credentials** for voice: `JARVIS_LIVEKIT_URL/API_KEY/API_SECRET`, then press
   the microphone yourself. That is the only honest way to qualify capture, recognition
   and playback.
