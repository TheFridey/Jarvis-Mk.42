# Vision qualification results

Date: 2026-10-02. Physical qualification: **PENDING**.

## Measured software/environment evidence

- Pinned 0.10.35 runtime: seven local assets passed SHA-256 verification.
- Browser: qualification page rendered, camera remained stopped, no page exceptions; MediaPipe initialized and closed successfully with HTTPS requests blocked. All observed runtime requests used localhost. This proves local inference-runtime initialization, not camera acquisition or tracking performance.
- Windows metadata probe: one 1920x1080 monitor, scale factor 1.25, foreground process/window bounds and cursor returned. Application/title/path are omitted here for privacy. No screen pixels were captured by this probe.
- Local Windows OCR: a generated PNG fixture containing `TS2304: Cannot find name widget.` was read exactly. This is a static fixture, not a real terminal screenshot or user interaction.
- Unit suite: 311 passed; later local capture-path hardening also passed its focused suite. Contracts 16, security 30, fitness 17, composed fixture integration 1 and regression integrations 12 passed. Both builds passed. Details and limits are recorded in AUDIT_PROMPT9_VISION.md.

## Hardware evidence still required

| Measurement | Result |
|---|---|
| Real webcam detection latency | Not measured |
| Physical tracking stability | Not measured |
| False gesture rate | Not measured |
| Physical pinch reliability | Not measured |
| Physical swipe reliability | Not measured |
| Tracking-loss release latency | Not measured |
| Device disconnect/reconnect | Not physically tested |
| Spoken pointing-to-terminal composed response | Not physically tested |
| Separate approved repair flow with real target | Not physically tested |

Run the manual procedure in VISION_V2.md and attach the exported derived report. Operator-attested reports are labelled explicitly; no source/unit/browser fixture result can substitute for physical evidence. Current camera-to-monitor mapping is unqualified. General cloud semantic vision is not enabled, and the local selected-error path analyses OCR text rather than arbitrary image semantics.

