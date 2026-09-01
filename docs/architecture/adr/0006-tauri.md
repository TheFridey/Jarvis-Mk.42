# ADR-0006: Tauri for the desktop shell

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
The Experience Plane needs a desktop application: multi-monitor UI, always-
available presence, system tray, global hotkeys, local capture coordination
with the voice/vision processes, and eventual OS-level integration for the
`windows` capability. It must be a thin client that consumes state and submits
validated commands (L6) — no authoritative state, no direct capability or model
calls.

## Decision
Build the desktop shell (`apps/desktop`) with **Tauri v2** (Rust host + web
frontend). The frontend is **Next.js/React** in static-export/SPA mode
(ADR context: Next.js is the mandated web framework) rendering from
`packages/sdk`. Tauri provides the native window management, tray, global
shortcuts, auto-update, and a small Rust sidecar boundary for OS hooks. Heavy
realtime perception stays in the separate `apps/voice` / `apps/vision`
processes, not in the Tauri host.

## Alternatives considered
- **Electron** — larger memory/binary footprint, Chromium bundled; more mature
  ecosystem but worse resource profile for an always-on shell.
- **Native (Rust egui / Swift / WinUI)** — best performance, but forfeits the
  React/Next.js web stack the project standardises on and multiplies platform
  work.
- **PWA / browser tab** — no tray, weak global hotkeys, poor multi-monitor
  control, no path to OS integration.

## Benefits
- Small footprint for an always-running shell; native webview.
- Reuses the React/Next.js/Motion/R3F frontend stack across desktop and web.
- Rust sidecar is a clean, minimal boundary for OS-level hooks feeding the
  `windows` capability and screen telemetry.
- Good auto-update and packaging story.

## Disadvantages
- Webview rendering differs across platforms (WebKitGTK / WebView2 / WKWebView)
  — testing matrix cost.
- Smaller ecosystem than Electron for niche native plugins.
- Rust knowledge needed for sidecar work.

## Risks
- A required native integration lacks a Tauri plugin. Mitigated: the Rust
  sidecar can implement it directly; the boundary is already there.
- Webview inconsistencies. Mitigated: MK.42 targets Windows primarily
  (workstation is Windows 11); cross-platform is a later concern.

## Consequences
- `apps/desktop` holds only view/session state; all mutations go through
  `packages/sdk` → validated `Command`/`Proposal`.
- The `windows` capability adapter and screen/cursor telemetry collector use
  the Tauri Rust sidecar's OS hooks but run under the Executor / perception
  rules respectively.

## Reversal difficulty
**Low.** The shell is a thin client over `packages/sdk`. Re-hosting the same
React frontend in Electron or a browser is a packaging change; no Kernel,
contract, or SDK change.
