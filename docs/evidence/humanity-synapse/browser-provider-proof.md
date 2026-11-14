# Browser provider proof

## Last executed run

`node node_modules/tsx/dist/cli.mjs scripts/presence-browser-acceptance.ts` - Chrome headless driven
over CDP, typing into the real Presence input and submitting the real form.

Product assertions that passed, 17/19:

| check | result |
|---|---|
| real gateway and kernel ready | PASS |
| static export built against the isolated kernel | PASS |
| presence served, browser started, input rendered | PASS |
| cloud consent control used | PASS |
| request reached the provider | PASS - 15,479 bytes |
| career sentinels present | PASS |
| SENSITIVE, unconsented and cross-principal absent | PASS |
| answer rendered | PASS |
| left THINKING, returned to STANDBY | PASS |
| general question sent, no memory block | PASS |
| second answer rendered | PASS |
| live export absent then absent (isolation) | PASS |

The two failures were in my assertions, not the product: the restore check required a backup to exist
(it correctly did nothing when there was no owner build), and I asserted the disclosure header arrives
at the provider, where it is deliberately never forwarded.

Both are corrected: the restore check compares hashes, and the disclosure assertion now reads the
Gateway's own receipt through `JARVIS_TRACE_DISCLOSURE=1`.

## Re-run blocked

Docker Desktop's Linux engine is returning HTTP 500 on its API, so PostgreSQL on 5433 is unreachable and
the isolated database cannot be created. The harness fails closed with
`write CONNECT_TIMEOUT 127.0.0.1:5433` rather than reporting success, which is the behaviour the
previous campaign asked for.

Per the standing contract I did not repair, restart or reconfigure Docker. That reconciliation is an
owner decision.

## Claimed

The browser journey is operational and its successful path was demonstrated with every product
assertion passing. The corrected 19-check run is not claimed as executed.
