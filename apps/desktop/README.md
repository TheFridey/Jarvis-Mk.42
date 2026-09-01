# apps/desktop — the Experience shell

Tauri v2 (Rust host + React/Next.js frontend) on the **workstation**
(ADR-0006). The primary surface a principal perceives JARVIS through:
multi-monitor UI, voice surface, notifications, approval UX, spatial UI
(R3F/Three.js consuming `@jarvis/scene`).

## Owns

View state, layout, local UI preferences, unsent input drafts, per-surface
session token. **Nothing authoritative** (L6).

## Interacts with JARVIS only via `@jarvis/sdk`

- **reads**: scoped projection subscriptions + notification stream;
- **writes**: typed `Command` / `Proposal` envelopes, validated by the Kernel.

## Must not

Write any authoritative store. Call a capability adapter or a model directly.
Hold provider/database credentials. Enforce policy (it may *reflect* policy
state).

## Native boundary

A small Tauri Rust sidecar provides OS hooks used by the `windows` capability
adapter and the screen/cursor telemetry collector — those run under the
Executor / perception rules respectively, not in the shell's trust context.

## GENESIS status

No frontend yet. Built in `ROADMAP.md` MK.49 (Experience).
