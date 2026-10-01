# Version semantics

JARVIS has two independent version dimensions.

1. **Product/build release** — the repository-level `productRelease` field in
   the root `package.json`. It identifies the integrated release candidate or
   build (currently `RC1.2`). This is the only top-level product release label.
2. **Architectural MK lineage** — workspace package and manifest versions such
   as `0.42`, `0.43`, `0.47`, `0.49`, and `0.50`. These identify the capability
   wave in which a component or contract originated. They are not claims that
   separately deployable products are simultaneously at different releases.

Component lineage versions change only when that component's contract or
compatibility semantics require it. They are deliberately not mass-bumped for
an integrated repository release. Canonical event `schemaVersion` values and
Node Protocol versions are separate compatibility contracts again; neither is
inferred from a package version or product release label.
