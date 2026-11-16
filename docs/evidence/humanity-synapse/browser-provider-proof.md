# Browser provider proof - executed 2026-11-14

Chrome headless driven over CDP against the real Presence interface: input typed into the real
control, form submitted through the real form, production Kernel and Gateway behind the socket, a
loopback provider as the only substitution.

## Result

```
node node_modules/tsx/dist/cli.mjs scripts/presence-browser-acceptance.ts
exit 0 - 22/22 assertions
```

| assertion | result |
|---|---|
| real gateway ready, real kernel ready | PASS |
| static export built against the isolated kernel | PASS |
| owner export restored untouched after the build | PASS - hash unchanged |
| presence served, browser started, input rendered | PASS |
| cloud consent control used | PASS |
| browser request reached the provider | PASS - 16,129 bytes |
| multiple career sentinels present | PASS |
| SENSITIVE, unconsented and cross-principal absent | PASS |
| answer rendered in the browser | PASS |
| interface left THINKING, returned to STANDBY | PASS |
| general question sent | PASS |
| no personal-memory block on a general question | PASS |
| second answer rendered | PASS |
| **career turn asked for a deep allowance** | PASS - `max_tokens` 6144 |
| **general question asked for a smaller allowance** | PASS - `max_tokens` 1536 |
| **gateway received a personal-memory classification** | PASS - observed `"disclosure":"personal-memory"` |
| **every turn with history reached the gateway as personal** | PASS |
| live export identical before and after | PASS - absent, absent |
| no acceptance build left where the launcher looks | PASS |

The last four are the evidence this campaign needed: the allowance exists on the provider's wire, and
the Kernel's own classification survives the hop to the Gateway rather than being asserted in a struct.

## How it runs

Two phases, because a full journey plus a Next.js build exceeds a single command budget:

1. `JARVIS_ACCEPTANCE_BUILD_ONLY=1 JARVIS_ACCEPTANCE_KERNEL_PORT=7421 ...` builds the static export
   into `.logs/browser-acceptance/export` against a fixed kernel port, leaving `apps/desktop/out`
   untouched, and exits.
2. `JARVIS_ACCEPTANCE_SKIP_BUILD=1` with the same ports runs the journey against that export.

The harness no longer shells out to `pnpm`, which refuses a non-TTY stdin and made the run unusable
outside an interactive shell; it invokes `tsx` and `next` directly.

## Two harness defects found here, both worth noting

- A new turn was detected by the answer text changing. The fixture answers every turn identically, so
  text is not a clock. A turn is now proven by a new arrival at the provider.
- The next question was submitted while the interface was still THINKING, which the interface refuses.
  That looked like a product failure - a silent NO_ROUTE - until the turn boundary waited for the
  interface to settle. Worth knowing: **a command submitted during THINKING is dropped, not queued.**

## Cleanup

Chrome, Gateway, Kernel and static server are killed by process tree in `finally`; the isolated build
is removed explicitly after the run; the owner's export was absent before and after. No test-owned
process or artifact remains.
