# Root cause — persistent memory invisible to live conversation

## Verdict

**The Kernel and the memory rows disagree about who the owner is.** The Kernel serves the
conversation as principal `principal-operator`. The 123 approved memories sit under
`local-owner`. Retrieval asks for `principal-operator`, gets an empty list, and the model
correctly reports that it has nothing. No error, no warning, no failure — just silence.

## Evidence (metadata only; no statement read)

Process identity — both live processes started today at 12:25, after commit `9e69b06` (12:11), so
the running build **does** contain the memory wiring:

```
7420 pid=20136  kernel   12:25:31
7430 pid=21092  gateway  12:25:31
4300 pid=6592   export   12:26:43
```

Database counts by principal:

```
local-owner                    0 pending  123 active   92 cloud-eligible   31 SENSITIVE
principal-operator             0 pending    0 active    0 cloud-eligible    0 SENSITIVE
synthetic-sentinel-principal   0 pending    3 active    1 cloud-eligible    1 SENSITIVE
synthetic-acceptance-principal 1 pending    0 active    0 cloud-eligible    0 SENSITIVE
```

Node registry and conversation history both use `principal-operator` (63 turns, 1 display node).

Selection, run against each principal with the exact failing queries and counting only what was
selected:

```
principal-operator  active=0    selected per query: 0, 0, 0, 0, 0
local-owner         active=123  selected per query: 5, 2, 7, 8, 2
```

The five queries are the ones that failed live: business mode, history before ScaleSmiths, progress
reflection, hype, and "what do you know about me".

## Why this was possible

`memory-cli.ts` defaulted to `local-owner` when `JARVIS_PRINCIPAL_ID` was unset. The Kernel's
principal is `principal-operator`. Nothing compared the two, and nothing counted what retrieval
found, so an identity mismatch was indistinguishable from an empty table.

## What I changed

1. **The CLI no longer invents a principal.** With no `JARVIS_PRINCIPAL_ID`, it reads the principal
   that owns the display node from `nodes.registry` and uses that — the same identity the
   application serves. Future imports cannot drift again.
2. **`memory adopt <from> [to] --confirm`** — a metadata-only repair for the existing 123 rows.
   Content, classifications, approvals and consents are untouched. It prints counts and does
   nothing without `--confirm`.
3. **`recallDiagnostics`** — counts per turn (candidates, approved, wrong-principal, class-eligible,
   cloud-eligible, irrelevant, budget-dropped, selected, block bytes). Emitted to stderr only when
   `JARVIS_MEMORY_TRACE=1`, never as content.
4. **Retrieval widened for broad intent** — reflection, project inventory, career history and
   profile questions now map to categories, because those phrasings contain no project names.

## The one action required from the owner

```powershell
node $pnpm memory adopt local-owner principal-operator --confirm
```

That is the entire fix for the live symptom. It moves 123 rows between principals; nothing else.

## Not established

I did not submit a live turn through Presence to capture the final provider body. The numbers above
prove selection; they do not prove a browser request carried the block. That reproduction is
outstanding and is the honest limit of this pass.
