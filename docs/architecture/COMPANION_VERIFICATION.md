# Companion verification — 3 October 2026

This records local implementation evidence, not deployment or physical-device qualification. Setup and security boundaries are in [COMPANION_NODES.md](COMPANION_NODES.md).

| Check | Result |
| --- | --- |
| `pnpm verify` | Typecheck and lint clean; 78 files / 343 tests passed |
| Desktop production build | Passed; static export generated |
| Security gate | 30 tests passed |
| Contract gate | 16 tests passed |
| Fitness gate | 17 tests passed |
| Node protocol integration | 18 tests passed using real mTLS and ephemeral PostgreSQL |
| Companion continuity integration | 2 tests passed using real Kernel, workers, mTLS and ephemeral PostgreSQL; fixture model provider |
| Wall browser review | Ambient, event expansion, narrow viewport and offline fixture reviewed |
| Android | Latest `assembleDebug` and `lintDebug` passed; 0 errors / 13 warnings; no device installation verified |

The companion integration tests cover desktop conversation continuation on mobile, canonical mobile status and worker orchestration on the wall, Scene-reference presentation, stored-result replay without duplicate inference, heartbeat while inference is pending, owner-targeted notifications, the mobile trust ceiling, wall command rejection and emergency self-revocation. Mobile inference is analysis-only, local and cloud-disabled. These checks do not prove live model quality.

Test sources: `apps/core/test/companion-continuity.integration.test.ts` and `apps/core/test/node-protocol.integration.test.ts`. Run a focused integration check in PowerShell with Docker available:

```powershell
$env:JARVIS_IT = '1'
pnpm exec vitest run apps/core/test/companion-continuity.integration.test.ts
Remove-Item Env:JARVIS_IT
```

Android toolchain: JDK 17, Gradle 8.11.1, AGP 8.9.2, Kotlin 2.1.20, compile/target API 35, minimum API 29. `apps/mobile/android/build-in-container.sh` builds in an isolated Linux toolchain, with source mounted read-only and output mounted separately. The workspace ARM host requires a Linux amd64 container for the Android build tools. The debug APK is for development, not a signed production release.

The final incremental build completed in 7 minutes 20 seconds. APK SHA-256: `B2FB4F922BCFE93F723150A930BA6FE3E2284C1F1A4AA5EE558974E617E68228`. Lint warnings comprise ten UI internationalization warnings, one missing application icon, one implicit SAM-instance warning and one recommendation to also declare legacy `fullBackupContent` for API 29–30. `allowBackup=false` is present and Android 12+ extraction rules explicitly exclude backup/transfer domains.

Artifacts:

- [Debug APK](../../artifacts/companion/jarvis-companion-debug.apk)
- [Android lint report](../../artifacts/companion/android-lint.html)
- [Machine-readable lint report](../../artifacts/companion/android-lint.xml)
- [Ambient wall](../../artifacts/wall-ambient.png)
- [Expanded event](../../artifacts/wall-event.png)
- [Narrow viewport](../../artifacts/wall-narrow.png)
- [Offline wall](../../artifacts/wall-offline.png)

The browser captures use an explicitly labelled preview fixture. Physical Android permissions, KeyChain provisioning, tunnel connectivity, Bluetooth/audio behavior, battery consumption and actual wall hardware remain unverified. Wake word remains unavailable pending a qualified local detector. Background camera capture is absent. Notification queue/batch storage is process-local and does not survive a Kernel restart. Production migration and deployment were not performed. The complete `verify:full` release gate was not run; the checks above are separate evidence.
