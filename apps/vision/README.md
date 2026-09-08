# JARVIS local vision runtime

`apps/vision` is the replaceable, non-authoritative perception process. The
development runtime opens a loopback-only page, requests the local webcam,
runs MediaPipe Hand Landmarker locally, and sends only typed derived signals
to the authenticated Kernel endpoint. Camera pixels are not sent to the Kernel
or persisted.

## Run on Windows

```powershell
pnpm stack:up
pnpm db:migrate
pnpm core:dev
pnpm --filter @jarvis/desktop tauri
pnpm vision:dev
```

Grant camera permission to `http://127.0.0.1:7440` and keep that local page
open. It reports genuine camera/model state. Pointing produces hover frames,
pinch focuses, held pinch moves, open palm requests a permitted dismissal,
swipe collapses, and camera/tracking loss releases interaction.

The first model/WASM load downloads public MediaPipe runtime assets. Inference
and frames remain local. Pin these assets under `public/` before claiming fully
offline startup.

`pnpm --filter @jarvis/vision screen:probe` exercises the Windows monitor,
foreground-window, and cursor collector. Pixel capture is not performed by
perception: `capabilities.windows.capture_region` is a HIGH-risk,
approval-required Executor action with local-file verification.

Selected-frame semantic vision is fail-closed. It requires a local object
reference and an approval for cloud transmission, and forbids RESTRICTED
frames. Continuous camera or screen upload has no contract.

CI uses synthetic landmarks and does not claim webcam, GPU, monitor, or
physical end-to-end validation.
