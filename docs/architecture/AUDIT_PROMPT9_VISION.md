# Prompt 9 implementation and evidence

Date: 2026-10-02.

Implemented: pinned local MediaPipe runtime/model and integrity gate; explicit camera start/stop/switch; bounded derived-only signals; monitor/process/window/cursor metadata with explicit repository binding; fresh multimodal reference resolution and ambiguity handling; authenticated scene focus observations; transient cyan scene brackets; a selected-region proposal form; always-live, input-bound capture approval; local Windows OCR and independent saved-artifact verification; principal-bound, expiring perception context; local-only RESTRICTED analysis; separate explicit repair targets; manual derived-measurement qualification/export.

Verification:

- Typecheck and structural lint: passed.
- Full unit suite: 311 passed; subsequently added local capture-path hardening passed its focused 17-test suite. No full-suite rerun was required for the later isolated path test and browser clock correction.
- Contracts: 16 passed.
- Security: 30 passed.
- Architecture fitness: 17 passed.
- Vision production build: passed; seven pinned asset hashes verified.
- Desktop production build: passed after clock hydration correction.
- Composed selected-error integration: 1 passed against ephemeral PostgreSQL with fixture capture/pointing/model. Real policy, grant, live approval, Executor verification, perception, Context Compiler, isolated agent worker and voice services were exercised. The fixture adapter does not acquire a camera or screenshot.
- Regression integrations: Kernel lifecycle 9, cognition 2, authenticated voice projection 1 passed (12 total).
- Browser: qualification harness renders with camera stopped; actual MediaPipe initializes using only localhost assets while HTTPS routes are blocked. Fresh static desktop browser session reports zero page exceptions; offline capture/command controls are disabled. A pre-existing clock hydration mismatch was found and corrected.
- Local OCR: generated error-text PNG read exactly by Windows.Media.Ocr. No workstation screenshot was used for this check.

The Docker Desktop engine was unavailable during the first integration attempt; that skip was not counted as proof. After engine restoration, one PostgreSQL port readiness attempt failed. The reported passing integration results are subsequent successful executions. The local Docker stack was restarted without removing volumes. No deployment or release certification was performed.

Boundaries: physical webcam gestures, calibration, false gesture rate, device disconnect/reconnect, spoken terminal-pointing acceptance, and physical repair acceptance are pending. General image semantics/cloud semantic vision remains disabled; selected terminal analysis uses local OCR. External application focus is a temporary indicator inside JARVIS, not an OS-level overlay. Hardware results have no invented latency values; see VISION_QUALIFICATION_RESULTS.md and the exact procedure in VISION_V2.md.
