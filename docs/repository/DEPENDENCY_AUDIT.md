# Dependency audit

Evidence: tracked TypeScript/JavaScript import/export/dynamic-import and
`require`/`require.resolve` syntax, package scripts, `pnpm list -r --depth 0`
and `pnpm why -r three react typescript zod esbuild vite --depth 1` on the
Prompt 01 graph. The reproducible read-only scanner is `pnpm deps:audit`;
`dependency-import-audit.json` records every remaining declaration, its import
paths and conservative static decision. It is evidence, not permission to
automatically remove a dependency with no static import.

| Scope | Decision and evidence |
| --- | --- |
| Core direct `@opentelemetry/api`, `drizzle-orm`, `postgres` declarations | REMOVE these three duplicate declarations only. No Core source/config/test import resolves them directly. Telemetry imports/owns the OTel API; persistence imports/owns Drizzle and postgres.js. Core imports those workspace boundaries. Packages remain installed through their real owners; no version changes or runtime library removal. |
| All remaining dependencies with direct imports, CLI/script references or compiler types | KEEP; exact source paths are recorded in the machine-readable audit. TypeScript remains 5.6.3 across the lockfile; tooling stays at existing versions. |
| Desktop `three`, React, R3F, `@react-three/postprocessing`, `postprocessing` | KEEP. Forge Cosmos imports the R3F effect wrapper; its resolved graph requires the postprocessing/Three peers. The graph resolves Three 0.186.1 and React 19.2.8 consistently. Removing a peer because the app has no direct import could change effects or resolution. |
| Desktop `@react-three/drei` | DEFER. No current direct app import found, but this is a visual helper dependency with its own peer graph. Do not remove in a behavior-preserving hygiene PR without a separate visual/native qualification matrix. |
| Desktop `@tauri-apps/cli` | KEEP. The `tauri` package script/command requires its binary; the package name differs from the binary name, so the generic scanner conservatively flags it. |
| Desktop `@jarvis/spatial`; adapter-host `@jarvis/capability-sdk`; labs/persistence/spatial `@jarvis/contracts` | DEFER. No direct static import in these owning workspaces. Desktop tsconfig maps spatial; Core fixtures import capability-sdk through the hoisted workspace. Reassigning ownership/exports needs separate package-boundary validation. No code deleted. |
| `kokoro-js`, Transformers/ONNX transitives, MediaPipe, LiveKit native packages | KEEP. Desktop audio worker/Next `require.resolve` uses Kokoro's Transformers web export; MediaPipe pins model/WASM runtime assets; RTC imports LiveKit. Native/CPU-specific optional packages must not be stripped from the lockfile based on this workstation's architecture. |
| Vite 5.4.21 / 6.4.3 and esbuild 0.21.5 / 0.25.12 / 0.28.2 | KEEP. Vitest 2 uses Vite 5/esbuild 0.21; vision uses Vite 6/esbuild 0.25; tsx uses esbuild 0.28. These are different consumers, not interchangeable duplicates. No forced override/dedupe or tool upgrade. |
| Repeated peer-qualified lockfile snapshots | KEEP. They express consumer peer contexts; repeated labels do not establish unused packages. |
| Old workstation node_modules containing unsaved/temporary packages | DEFER local cache cleanup. It is ignored and not part of source. Fresh Windows/Linux CI installations are the authority for required dependencies, not residue from prior installs. |

The lockfile change removes only the three Core importer entries. Package
records, resolutions, native architecture variants and visual versions remain
unchanged. A fresh frozen installation plus full Linux gates and Windows
typecheck/unit/desktop build validates the resulting graph; live audio/GPU
behavior remains a separate qualification, not a claim inferred from mocks.
