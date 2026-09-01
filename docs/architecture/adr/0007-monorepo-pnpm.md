# ADR-0007: pnpm monorepo

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
JARVIS is many deployable units (`apps/*`) sharing many libraries
(`packages/*`), plus manifests (`agents/*`, `capabilities/*`). Contracts
(`packages/contracts`) must be shared with zero version skew — an `Event`
envelope mismatch between the Kernel and a consumer is a critical bug. We need
atomic cross-cutting changes (change a contract + all consumers in one commit),
fast installs, and strict dependency isolation so a package cannot import
another's internals by accident.

## Decision
One **pnpm workspace** monorepo. `pnpm-workspace.yaml` globs `apps/*`,
`packages/*`, `agents/*`, `capabilities/*`. TypeScript project references from
`tsconfig.base.json`. Internal packages referenced by `workspace:*`. A task
runner (Turborepo or `nx`) is added in MK.43 for build/test caching; not
needed for GENESIS. Strict `pnpm` settings (`shamefully-hoist=false`) so
phantom dependencies fail.

## Alternatives considered
- **Polyrepo** — independent versioning, but contract changes become
  multi-repo dances with version negotiation — exactly the provider-lock-in /
  hidden-coupling class of problem the constitution is hostile to.
- **npm / yarn workspaces** — workable; pnpm chosen for strictness (no phantom
  deps), disk efficiency, and speed.
- **Bun workspaces** — fast and improving; pnpm chosen for maturity and
  ecosystem certainty on a ten-year project. Bun may still be used as a
  script/test runner.
- **Nx integrated monorepo (generators, plugins)** — powerful but opinionated
  and heavy; we adopt Nx/Turbo only as a cache layer, not as the project's
  spine.

## Benefits
- Atomic cross-package changes; one PR changes a contract and every consumer.
- Single source of truth for shared types; no version skew.
- Strict isolation surfaces accidental coupling at build time.
- Fast, disk-efficient installs; good CI caching.

## Disadvantages
- Repo grows large; needs a task runner and CI affected-graph logic to stay
  fast (planned MK.43).
- All contributors clone everything.
- Requires discipline to keep `packages/*` genuinely reusable and not a
  dumping ground.

## Risks
- Monorepo becomes a monolith of coupling if boundaries aren't enforced.
  Mitigated: `SYSTEM_BOUNDARIES.md`, lint rules on import paths, per-package
  `exports` maps.
- Build times. Mitigated by Turbo/Nx caching + TS project references.

## Consequences
- New deployable unit = new folder under `apps/`; new shared lib = new folder
  under `packages/`.
- CI runs an affected-graph to test only what changed.
- `packages/contracts` has no dependency on any other internal package
  (leaf of the graph).

## Reversal difficulty
**Low.** Splitting a package into its own repo later is a `git filter-repo` +
publish-to-registry + swap `workspace:*` for a semver range. The extraction
seams (`SYSTEM_BOUNDARIES.md` §10) are defined precisely so this is possible.
