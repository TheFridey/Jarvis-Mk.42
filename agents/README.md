# agents/

The named roster of **disposable cognitive workers** (L9, L10). Each folder
holds a `manifest.json` read by the existing Kernel Agent Runtime at
`apps/core/src/kernel/cognition`. `packages/agents` is an extraction seam,
not the runtime implementation. All eleven manifests remain registered.
Durable job history lives in PostgreSQL `cognition.agent_jobs` (Runtime-owned);
bounded context is passed transiently to a fixed child process. Node permissions
are defense in depth, not an OS/container sandbox or network firewall.
Admitted jobs drain through commit notifications and the existing Scheduler's
lease sweep. Restart recovery recompiles context when a trusted caller
resubmits the original identity-bound request; prompts are not duplicated in
durable job history. Unknown inference outcomes block rather than retry.

## Manifest schema

| Field | Meaning |
|---|---|
| `id` / `version` / `displayName` | Identity |
| `role` | The single job this agent does |
| `leasePolicy` | Hard caps: `maxWallTimeMs`, `maxContextUnits`, `maxCostUnits` |
| `proposalScope.kinds` | Which `Proposal` kinds it may return |
| `proposalScope.capabilities` | Which capability ids it may *propose* invoking (still gated by the Executor) |
| `modelHints` | Preferred `ModelTask`s + `locality` for the gateway |
| `notes` | Constraints, expectations |

## Invariants for every agent

- Holds **no** credentials (DB, NATS, provider).
- Reaches the Model Gateway only through the Runtime's mediated channel
  (`onBehalfOf` stamped).
- Returns `Proposal`s / `Observation`s over the control channel; the **Runtime**
  emits events after validation (review §16.7).
- Cannot call the Executor, publish to NATS, or spawn sub-agents directly.
- Killing it mid-run loses no system state.

## Roster

| Folder | Agent | Job |
|---|---|---|
| `oracle` | Oracle | General reasoning / Q&A over compiled context |
| `forge` | Forge | Software implementation (proposes fs/terminal/github/docker) |
| `scout` | Scout | Research / retrieval (web content tagged untrusted) |
| `argus` | Argus | Monitoring / watch tasks / anomaly surfacing |
| `hermes` | Hermes | Communications drafting & delivery |
| `sentinel` | Sentinel | Security review, policy-recommendation drafting, risk analysis |
| `atlas` | Atlas | Data analysis / quantitative synthesis |
| `mnemosyne` | Mnemosyne | Memory curation: summarisation, linking, decay proposals |
| `prometheus` | Prometheus | Planning / foresight / objective decomposition support |
| `daedalus` | Daedalus | Design & architecture reasoning; simulation scenario construction |
| `hephaestus` | Hephaestus | Build/infra automation authoring |
