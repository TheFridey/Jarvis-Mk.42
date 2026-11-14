# INHERITANCE · Final Ascension

Baseline `bd21784` (clean) → this pass. Owner principal `local-owner` untouched; no owner memory
was read, approved, revoked or exported. All fixtures synthetic.

## Phase status

| Phase | Status | What that means |
|---|---|---|
| 0 · post-recovery preflight | **VERIFIED** | Services healthy (postgres/redis/nats/livekit), HEAD clean at baseline, backup archive present, baseline reproduced |
| 1 · full-chain privacy proof | **VERIFIED** | 9/9 captured at the final provider body through the real adapter |
| 2 · revocation hardening | **PARTIAL** | revalidation at dispatch + documented window; no atomicity claim |
| 3 · adaptive retrieval | **VERIFIED** (policy) | mode-aware budgets; deterministic tests |
| 4 · HUMANITY acceptance | **PARTIAL** | deterministic context cases automated; prose quality needs a live, authorised round |
| 5 · recovery resilience | **PARTIAL** | guarantees analysed; resumable review CLI not implemented |
| 6 · owner handover | **VERIFIED** | runbook below |
| 7 · RESONANCE III readiness | **VERIFIED** (planning) | inventory + roadmap, no implementation |

## Preflight evidence

- `git rev-parse HEAD` → `bd21784`; `git status --porcelain` → 0 files.
- `docker ps` → postgres, redis, nats all `Up (healthy)`, livekit `Up`.
- Disk: C: 16 GB free (93 %), D: 654 GB free (30 %).
- Baseline suite before any change: 804 passed / 4 skipped / 0 failed / 136 files.
- Backup `D:\JarvisData\Backups\jarvis-recovery-20261114-095255.dump` present (archive catalogue
  verified by the owner during recovery; not re-read here, and never restored).

## Full-chain proof

```
synthetic records → composeMemoryContext (real selector, mode budget)
  → CognitionOrchestrator (real routing + real constraints)
  → AgentRuntime (real manifests, budget clamp, correlation checks)
  → HttpModelGatewayClient (real fetch, SSE)
  → Model Gateway process (real, port chosen per run)
  → OpenAICompatibleAdapter (real, unchanged)
  → mock provider on loopback  ← final body captured
```

**Substituted:** `ContextCompiler` returns a fixed `INTERNAL` ceiling and the `cognition.runs`
insert is answered by a stub. Everything else is the application's own code, and the adapter under
test is the one that would talk to OpenRouter.

**Egress prevention:** `JARVIS_OPENROUTER_BASE_URL` is a new seam that defaults to the real
endpoint and **refuses to start** unless `JARVIS_ALLOW_PROVIDER_REDIRECT=1` is also set. The proof
run also picks an ephemeral port per execution, because an orphaned gateway from an interrupted
run was observed still serving a stale configuration — the same class of defect the launcher fixed.

Evidence: `provider-wire-proof.json`, `privacy-matrix.md`.

## Revocation and concurrency

Ordered guarantee, per the disclosure boundary ADR:

1. **Before selection** — never considered.
2. **After selection** — recomposition removes it (proven, row 13).
3. **Before dispatch** — re-read immediately before `runtime.invoke`; a revocation landing here is
   caught.
4. **Concurrent with transmission** — **not prevented.** The interval is the gap between the final
   re-read and the socket write: single process, no transaction held across the network call.
5. **After transmission** — cannot be recalled. Revocation governs future context only.
6. **Between retries** — not implemented; the client does not retry, the gateway does, and the
   gateway has no memory visibility.

Holding the memory rows in a transaction spanning the provider request would give the appearance
of atomicity and not the fact. The honest boundary is stated above rather than engineered away.

## Adaptive retrieval

| mode | trigger | limit | minScore |
|---|---|---|---|
| CASUAL | default, greetings, banter | 2 | 0.4 |
| OPERATOR | restart, audit, diagnostics | 3 | 0.5 |
| ADVISOR | business mode, pricing, roadmap | 5 | 0.4 |
| REFLECTIVE | "how far have we come" | 7 | 0.35 |
| HYPE | "hype session", "go deeper" | 8 | 0.35 |

Mode changes relevance and budget **only**. It cannot alter eligibility, ceilings or consent —
covered by tests that request a deeper hype session against SENSITIVE records and still see them
withheld from a cloud turn.

## Owner handover

```powershell
cd D:\Projects\Jarvis-Sentience
$pnpm = "C:\Users\rhysl\AppData\Local\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs"
$env:JARVIS_DB_URL = "<your existing value>"

node $pnpm memory list                 # 66 pending / 57 active at recovery
node $pnpm memory show <id>
node $pnpm memory approve <id>         # local use only
node $pnpm memory grant-cloud <id>     # separate, explicit, INTERNAL/PUBLIC only
node $pnpm memory revoke-cloud <id>
node $pnpm memory correct <id> "subject" "statement"
node $pnpm memory revoke <id>          # stops use, keeps statement
node $pnpm memory delete <id>          # removes the statement, keeps the audit fact
```

Local approval ≠ cloud consent. Nothing in a conversation, a classification or an engineering
instruction can grant consent; only `grant-cloud`, per record.

Restart: `scripts/jarvis-up.ps1 -Down` then start from the key-bearing shell. Kernel restart is
required for identity/retrieval changes; the gateway reloads on its own.

First personalised session, once approvals are done: greet, reference something you know is
approved, ask "how far have we come", then "give me a proper hype session" and check every claim
against a record you actually approved.

## RESONANCE III readiness

Present: whisper.cpp ARM64 (b5454, RTF 0.17), adaptive VAD with pre-roll, `/voice/utterance` +
`/voice/speak`, VOICE ON playback, presence states, browser acceptance gate.

Absent: British male Kokoro voice, streaming synthesis, barge-in, prosody, orb audio reaction.

Roadmap: memory-aware voice registers (HYPE spoken ≠ ADVISOR spoken) → local Kokoro with pinned
weights on D: → streaming synthesis with sentence-level chunking → barge-in via VAD on the
playback path → orb driven by real playback amplitude (needs a `voice.write` session, not a
desktop one).

## Remaining risks

- ContextCompiler substitution in the proof (documented above).
- No retry-path memory revalidation.
- Owner memory is real data; the harness cannot see it, so retrieval quality on the real pack is
  unmeasured until the owner interacts.
