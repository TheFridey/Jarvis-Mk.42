# HUMANITY: AWAKENING — report

Baseline `9e69b06` → this pass. Owner data untouched: no statement read, no approval, no grant, no
reclassification, no delete.

## Root cause

Principal mismatch. Kernel serves `principal-operator`; 123 approved memories belong to
`local-owner`. Retrieval returned zero and the model truthfully said it had nothing. Full evidence
in `root-cause.md`.

## Composition comparison: production vs the SENTINEL harness

| | production | SENTINEL harness |
|---|---|---|
| principal | `principal-operator` (node registry) | synthetic principal, hand-chosen |
| memory source | `PersonalMemoryStore.loadForSelection(node.principalId)` | same store, but seeded with that same id |
| ContextCompiler | real, wired in `kernel.ts` | real, wired in the script |
| gateway/adapter | real | real, redirected to loopback |

The wiring was correct in both. The harness could not have caught this defect because it chose the
principal and the data together — the one thing production does not do.

## Retrieval after widening (metadata only)

| query | before | after |
|---|---|---|
| business mode, what are we working on | 0 | 5 |
| what did I do before ScaleSmiths | 0 | 2 |
| how far have we come recently | 0 | 7 |
| hype session, go deep | 0 | 8 |
| what do you actually know about me | 0 | 2 |

Counts are selected records for `local-owner`, cloud locality, with 92 cloud-eligible of 123.

## Fixes

- CLI resolves the Kernel's principal instead of defaulting to a made-up one.
- `memory adopt` for the existing rows (owner action, `--confirm` required).
- `recallDiagnostics` + `JARVIS_MEMORY_TRACE=1` stderr lines: counts only.
- Intent mapping widened for reflection, project inventory, career history, profile questions.

## Verification

| Check | Result |
|---|---|
| Focused memory tests | 105 passing |
| Full suite | run at commit time; see commit message |
| Typecheck / lint / fitness / build | clean |

## Not done, and why

- **Browser-to-provider reproduction**: requires driving Presence against an isolated instance with
  a synthetic principal and a loopback provider — a new harness, not a fix. The selection counts
  above are the strongest evidence produced here, and they are metadata only.
- **Gateway retry revalidation**: not implemented. The gateway can retry a body it was given
  without re-reading memory consent.
- **Compose restart policy**: postgres/redis/nats are `restart: no`, livekit `unless-stopped`.
  Recommend `unless-stopped` for the three, but changing it recreates containers, which is not
  authorised here.

## Owner steps

```powershell
node $pnpm memory adopt local-owner principal-operator --confirm   # the fix
node $pnpm memory list                                            # expect 123 active under the Kernel principal
```

Then restart the Kernel, open a fresh conversation, and repeat the acceptance prompts. A retry of
"What do you actually know about me?" is the sharpest single test: it either retrieves 2 records or
it does not.
