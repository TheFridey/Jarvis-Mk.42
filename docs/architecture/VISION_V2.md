# Vision V2 and selected-error context

Camera frames remain in the local browser and MediaPipe runtime. The Kernel accepts a strict allowlist of derived signals, never pixels, image bytes or arbitrary fields. Hand landmarks are not used as evidence that a person is absent. Runtime confidence currently combines handedness classification and calibration quality; it is a heuristic, not a calibrated probability of correct pointing.

## Offline assets

MediaPipe Tasks Vision is pinned to 0.10.35. Seven model/WASM/loader files are included under `apps/vision/public/assets/mediapipe`, with SHA-256 pins in `apps/vision/src/runtime-assets.json`. `pnpm vision:assets` provisions and verifies these files; the provisioning step can download the versioned model if it is absent. Browser startup never downloads CDN assets and rejects missing or changed files. Package installation and first provisioning must precede offline use.

Sources: [official Tasks Vision package](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md), [official hand-landmarker sample](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/hand-landmarker.ts). The package and model retain their upstream terms; this repository does not relabel upstream assets as JARVIS-owned.

## Workstation observations

The Windows collector observes monitor topology/DPI, foreground window bounds, process/application/PID, cursor and timestamp. It does not screenshot. Browser metadata cannot overwrite fresh Windows metadata. Scene focus is an authenticated presentation observation (`POST /desktop/perception`); unknown scene objects are rejected. It conveys context, never effect authority.

Repository context is supplied only through an explicit process binding in `JARVIS_WORKSPACE_BINDINGS`, for example an array with `processId`, `application` and `rootPath`. The collector requires a matching foreground PID/application and an existing directory. A `.git` entry provides deterministic repository evidence. Window titles are not interpreted as repository paths. PID bindings must be refreshed after process restart.

## Explicit selected capture and local OCR

On the Windows workstation, enable the adapter explicitly before starting Core: `$env:JARVIS_ENABLE_SELECTED_CAPTURE='1'; pnpm core:dev`. The startup flag registers the reviewed adapter and a bootstrap operator grant with no standing approval for captures. It requires no external credential. The desktop SELECT ERROR REGION form proposes coordinates and a local PNG path; the normal approval card controls execution. This does not start a camera or capture anything on startup.

`capabilities.windows` 1.2.0 `capture_region` accepts signed monitor coordinates and optional `extractText: true`. It always requires a live approval bound to the invocation input; broad standing grants do not replace that approval. It saves only the explicitly selected region to a new, absolute local PNG path. UNC/network drives, relative paths, and overwriting existing files are refused. A separate verifier rereads this saved artifact (hash, timestamp and OCR text); it never captures a second region during verification. Screen capture simulation is disabled until a distinct dry-run authority path exists.

Windows.Media.Ocr runs in an isolated local PowerShell process with a bounded timeout. Missing OCR languages/runtime fail closed. Only a verified capture result can register selected text with the Kernel's bounded, process-local perception context. There is no public endpoint accepting arbitrary OCR text as a trusted capture. The approved screenshot file remains at its selected path; the operator controls its subsequent retention. Continuous webcam frames are never saved.

Selected text is RESTRICTED, provenance-tagged as untrusted observation, bounded to 8,000 characters, and available for 120 seconds. Resolved context references expire after 15 seconds and are bound to principal/node at creation. Context Compiler refuses to proceed if privacy or budget truncation would omit any required perception item. RESTRICTED context requires a permitted local model and cannot route to cloud. Error text may contain malicious instructions; it is data, not Kernel authority.

Cloud semantic image transmission remains unwired. The selected-frame decision helper requires a Kernel-verified projection containing frame/request/principal/privacy binding, expiry, policy and privacy checks; a string approval ID is insufficient. RESTRICTED frames always fail. This helper cannot issue authority or transmit pixels.

## Reference resolution and presentation

Fresh Air Touch, cursor, focused/selected scene objects, explicit selected region, active application bounds and recent objects can contribute referents. Confidence thresholds are 0.75 for analysis and 0.9 for world-affecting requests. Conflicting candidates and overlapping scene hits ask for clarification; z-order does not establish semantic intent. Unknown/stale objects are excluded. Cursor coordinates are assigned to their actual monitor. Freshness is three seconds for live observations, thirty seconds for scene objects and eight seconds for recent objects.

Analysis combines the user utterance, current application/topology/cursor, selected scene metadata and gesture target where available, plus approved selected-region OCR. It uses ORACLE in answer mode and suppresses capability execution. A separate repair request can use FORGE after an explicit file target and deterministically bound workspace are available and enters ordinary proposal/policy/permission/executor/verification. A screenshot does not identify a writable file.

The Experience shows a cyan scene focus bracket for 2.5 seconds, with confidence only in development diagnostics. External workstation targets receive a temporary selected-region indicator; this implementation does not draw an OS-level bracket over another application's terminal. There are no persistent surveillance boxes.

Air Touch remains presentation-only: point/hover, pinch/focus, held pinch/move, dwelled open palm/permitted dismiss, swipe/collapse. Loss releases the interaction once; reacquisition resets pinch state; release does not jump the object. World effects cannot be emitted by the scene reducer. Physical-pixel monitor calibration must match the actual display; scene CSS and external workstation coordinates must not be assumed interchangeable.

## Qualification and exact acceptance procedure

Run `pnpm --filter @jarvis/vision screen:probe`, then `pnpm vision:qualify`. Select the webcam and enter the actual monitor ID/origin/dimensions. Start explicitly. No camera opens before Start. Use Begin fresh session, hold a stationary point, run repeated pinch/swipe/tracking-loss trials, record failures and false gestures, and observe at least ten minutes. Export the derived JSON report. Trial timing includes the operator's response to the start button; inference latency is measured separately and must not be relabelled as pure gesture-onset latency. Disconnect/reconnect the camera and confirm lost interactions release; reconnection requires selecting Start again.

For the composed interaction:

1. Show a terminal with an error and point to it. Speak "Jarvis, what's wrong with that?". If the application alone resolves, JARVIS must explain that it has not read the pixels and request an explicit selected capture; ambiguity must ask which target.
2. Submit a separate `capture_region` proposal for precisely that error region, with `extractText: true` and an approved local output path. Review and approve the normal Agency card. RESTRICTED content stays local.
3. Point again and repeat the question. Context Compiler should contain the voice turn, approved OCR text/hash, current application/screen and available scene/gesture observations. ORACLE should explain the error, with no repair effect.
4. Bind the actual repository/process and explicitly ask for a repair. Name the file and submit a separate FORGE request or explicit capability proposal; a deictic repair of the screenshot remains blocked. FORGE may propose a file/terminal capability; its target must be explicit and normal policy/approval must remain in force. Review the separate repair proposal before execution.
5. Record measured inference/response/gesture latencies, trial successes/failures, device-loss behaviour, correlation/invocation IDs and observed answer. Redact error text and window titles before sharing evidence. Do not include raw frames or audio in the default report.

The software fixture test is not evidence that Rhys physically performed this interaction. See VISION_QUALIFICATION_RESULTS.md for the current evidence boundary.



