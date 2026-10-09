# Source assets and generated evidence

Audit baseline: `f699ab06132bfe3c5a158e6d2845a1a7e75155fd` (Prompt 01).
The visual-validation tree held **1,021,811,302 bytes**: 638 PNGs, 16 WebMs and
two JSON reports. No runtime import or checked-in regression runner reads its
motion recordings/frames. Repeated extracted frames are historical evidence,
not application artwork or active comparison baselines.

| Classification | Decision |
| --- | --- |
| Runtime MediaPipe task/WASM/JS, logo, Tauri icons and shader source | KEEP byte-identical; SHA-256 inventory in `preserved-assets.json` |
| 48 curated static visual screenshots across viewport/state/fallback/reduced-motion cases | KEEP conservatively at their original paths for manual comparison |
| `cinematic/checks.json`, `models/checks.json`, dated written reports and referenced wall captures | KEEP as historical evidence; not proof of current release behavior |
| 590 extracted motion PNGs and 16 WebMs | REMOVE from source tracking; 931,344,141 bytes, regenerate/upload as CI evidence |
| 15 old `apps/desktop/out` export files | REMOVE from tracking; 808,071 bytes, rebuilt from source |
| APK and Android HTML/XML lint reports | REMOVE from tracking; 3 files / 3,795,456 bytes, build outputs |
| `artifacts/mark42/*` and local-runtime desktop capture | REMOVE from tracking; 23 files / 3,092,172 bytes, dated generated qualification outputs |
| Cargo.lock, pnpm-lock.yaml, native manifests and tool/config files | KEEP; reproducibility inputs, not caches |
| node_modules, Next caches, Gradle caches/builds, Cargo target, local secrets | Already ignored; no tracked cache directories found in this audit |

Total removed from the source index: **647 files / 939,039,840 bytes**.
`untracked-generated-assets.json` records every removed path, size and SHA-256
for review/archive recovery. Files were removed with `git rm --cached` and
remain on the original workstation. No runtime source or artwork was deleted.
`preserved-assets.json` protects 109 retained files with `pnpm assets:check`.
That CI check also rejects generated output tracked under the removed roots.

## Future evidence and retention

Write motion recordings and extracted frames to
`apps/desktop/visual-validation/motion/` (ignored), browser traces/screenshots
to `test-results/` or `playwright-report/`, generated integration reports to
`artifacts/mark42/`, Android output to `artifacts/companion/`, and device
qualification to `artifacts/hardware-validation/`. Both quality jobs upload
available evidence with `actions/upload-artifact@v4`, even after gate failure,
with **14-day retention** and commit-qualified names. The Linux job includes
integration/Android/device paths; the Windows job includes browser evidence.
The workflow does not fabricate recordings or claim an absent visual/device
runner executed. Never place credentials, raw private business data or user
camera/audio captures in these automatically uploaded directories.

Local ignored evidence has no automatic age-based deletion. Archive important
release evidence to a separately controlled release store before CI retention
expires. Curated source baselines stay tracked; do not ignore all PNG, WASM,
shader, model, DLL or binary extensions globally.

## Optional shared Git history cleanup (not performed)

Untracking reduces fresh working-tree content but old blobs remain in Git
history and may still affect clone size. History cleanup is a separate,
explicitly coordinated maintenance operation. First archive required evidence
and make a verified mirror backup; identify exact generated paths from the
inventory, and rehearse a path-only `git filter-repo` operation in a disposable
mirror. Review tags, branches, signed releases, PR references and remote forks.
Agree a maintenance window and recovery plan before replacing remote refs;
collaborators must reclone/rebase correctly. Avoid extension-wide filtering
which could erase runtime assets. No filter, force-push, shared ref rewrite or
automatic garbage collection is part of this PR.
