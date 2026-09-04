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

## Current status

A Next.js/Tauri experience client exists with semantic-scene rendering,
Kernel snapshot polling, bounded reconnect, fail-closed proposal submission,
and nonce/version-bound approval surfaces. The development gateway is
loopback-only; production Node Protocol authentication and hardware validation
are not complete.

## Local live workflow

```powershell
# Terminal 1
pnpm stack:up
pnpm db:migrate
pnpm core:dev

# Terminal 2
pnpm --filter @jarvis/desktop tauri
```

Defaults connect to `http://127.0.0.1:7420` with the explicit local-development
token `dev-desktop-token`. Set matching `JARVIS_DESKTOP_TOKEN` and
`NEXT_PUBLIC_JARVIS_DESKTOP_TOKEN` values to override it. See
[`docs/architecture/DESKTOP_TRANSPORT.md`](../../docs/architecture/DESKTOP_TRANSPORT.md).

For visual work without Core, set `NEXT_PUBLIC_JARVIS_DEMO_MODE=1`. The UI is
then visibly labelled `DEMO MODE`, and authoritative commands are disabled.
