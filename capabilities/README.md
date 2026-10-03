# capabilities/

Capability **manifests** (`docs/architecture/AGENCY_MODEL.md`, ADR-0016). Each
folder holds a manifest describing a class of effects. Selected capabilities,
including filesystem operations, have out-of-process implementations; other
folders remain contract-only until their providers are implemented and tested.

Email, Calendar and ScaleSmiths have operational adapter implementations registered
through `JARVIS_INTEGRATIONS_CONFIG`. See
[configuration and upstream contract](../docs/architecture/SCALESMITHS_INTELLIGENCE.md).
ScaleSmiths requires a general operations service implementing the documented
boundary; its existing Venture Lab MCP is not that boundary. Writes require
per-action grants and live approval; unsupported ScaleSmiths updates remain absent
from the runtime registry.

**Registering a manifest touches only the Capability Registry. The Kernel
binary does not change** (L28, L29).

## Every invocation runs through the single Executor pipeline

validate → policy → permission → freshness barrier + `capability.started` →
resource lease → simulate (if `riskClass >= HIGH`) → execute → **verify** →
emit result → rollback / saga-compensate on failure.

## Manifest fields (subset of `@jarvis/contracts` `Capability`)

`id`, `version`, `requiredScopes`, `trustTierMin`, `resourceKeySelector?`, and
`actions[]` where each action has `name`, `inputSchema`, `outputSchema`,
`riskClass`, `reversible`, `rollback?`, `simulate?`, `simulatable`, `verify`
(**mandatory**), `idempotent`, `steps?`, `sideEffects`.

## Set (MK.42)

| Folder | Effects | Typical host node |
|---|---|---|
| `filesystem` | Read/write files within a workspace root | local server / workstation |
| `terminal` | Run shell commands in a workspace | local server |
| `browser` | Drive a headless/controlled browser | local server |
| `web` | HTTP fetch of external resources (content tagged untrusted) | local server |
| `github` | Repo/PR/issue operations via a repo-scoped token | local server |
| `docker` | Container lifecycle via the Docker socket | local server |
| `windows` | OS-level control of the workstation | workstation |
| `scalesmiths` | Operations on the ScaleSmiths business (its infra, accounts, tooling) | local server |
| `smart-home` | **Future.** Device control. CRITICAL-heavy. | a device/robot node |
