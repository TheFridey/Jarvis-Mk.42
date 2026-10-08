# Model visuals, usage and input checkpoint — 8 October 2026

## Implemented

- Each observed model can retain its own visual preset in the desktop's local preferences. Automatic follows the observed model; GPT has a mint ribbed core, Claude a warm lobed core and serif title, OpenRouter a violet flattened core, and JARVIS a gold sphere. These are JARVIS styles, not official provider interfaces. Previewing a style does not manufacture model activity or change inference.
- Typed requests carry a saved preferred model ID through the desktop command and companion service to cognition. The default is `gpt-6.1-sol`. The server also prefers that ID for requests without explicit preferences, including voice. `JARVIS_PREFERRED_MODELS` overrides the server preference. Gateway OpenAI and Anthropic defaults are `gpt-6.1-sol` and `claude-opus-5-5`; existing deployment overrides remain authoritative. Privacy, eligibility, budgets and fallback remain enforced. OpenRouter still requires its exact `JARVIS_OPENROUTER_MODEL` route.
- The usage panel selects a recorded model and 24 hours, 7 days, 30 days or all retained history. Aggregation runs over stored completed cognition runs for the authenticated principal, independently of the 100-row activity feed. New formatting retries preserve individual model/call usage so a changed model is not charged the whole run. Older rows retain their original recorded attribution.
- Actual provider-reported USD charges, coverage, input/output tokens and configured cost estimates are separate. Missing actual charges remain unknown; partial coverage is labelled. This is recorded completed JARVIS activity, not a reconciled provider invoice: failed/crashed requests, external applications and older missing measurements are not included.
- OpenRouter response `usage.cost` is retained. OpenAI/Anthropic rate-limit headers are retained as timestamped observations of a provider bucket. OpenRouter key spend limits/remaining values are fetched server-side, cached for one minute and marked as shared across models. An absent key limit is not treated as a model allowance. No provider keys are sent to the desktop.
- The main desktop can start/stop local webcam tracking with pinned, integrity-checked MediaPipe assets copied into its export. Point/pinch/drag/palm/swipe drive the existing presentation-only gesture resolver; capability execution and approval stay in the Kernel. Camera capture is explicit and stopped on teardown. The mapping currently targets the primary 1920×1080 semantic scene; additional-monitor calibration still uses the vision app.
- Node 24's removed `--experimental-permission` flag prevented isolated model workers from starting. The launcher now selects the supported permission flag without removing the sandbox.
- Particle size compensates for lower quality density and mobile responses use a bounded dock so the scene stays visible.
- Root development dependencies now explicitly declare the zod and OpenTelemetry test imports used by the repository's TypeScript check.

## Validation

- Repository TypeScript and custom lint pass.
- Focused desktop, gateway, voice, vision, companion, projection and agent-runtime suites pass (196 tests), with a further backend pass covering 77 tests (244 distinct tests across both runs).
- PostgreSQL-compatible PGlite execution of the actual aggregate query checks all period boundaries, principal isolation, failed-run exclusion, partial cost coverage and cross-model retry attribution.
- Demo export and normal desktop export pass. MediaPipe emits its existing webpack dynamic-import warning.
- Browser checks exercise all three presets, persistence, preferred-model persistence, the four period options, permission rejection and mobile overflow. No browser errors or horizontal overflow observed.
- A synthetic browser camera starts the actual pinned MediaPipe runtime and stops cleanly with no browser errors. This does not qualify real hand accuracy or latency.

## Still requires live qualification

This workspace has no configured provider API keys or live Core credentials and no access to the operator's microphone/camera. No deployment, paid inference or physical device qualification was performed.

On the Windows desktop, start the configured Core/Gateway and RTC stack, run `pnpm voice:preflight`, then `pnpm voice:qualify`. Test “Jarvis”, partial/final recognition, audible reply, interruption, follow-up context, false wakes, self-trigger prevention, input/output switching and device recovery. Keep the dedicated voice process for ambient wake recognition; browser RTC is an explicitly started audio session. Existing local adapters do not claim acoustic echo cancellation.

Use the new Air Touch button on HTTPS or localhost, allow the camera, then verify point/pinch/drag/palm/swipe and tracking loss against real scene panels. Use `pnpm vision:qualify` for calibrated multi-monitor trials and measured physical qualification.

Deploy this branch before testing the live desktop. Verify the exact selected model and fallback in real runs; changing a default cannot grant provider access. For fully reconciled OpenAI/Anthropic dollar spend and subscription allowances, connect the appropriate account billing/usage source. This patch does not infer invoice totals from missing cost data.

## Primary documentation checked

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://platform.claude.com/docs/en/models/opus-5-5/overview
- https://developers.openai.com/api/docs/guides/rate-limits
- https://platform.claude.com/docs/en/api/rate-limits
- https://openrouter.ai/docs/cookbook/administration/usage-accounting
- https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
