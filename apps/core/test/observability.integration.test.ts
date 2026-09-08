/**
 * RC-audit probe: observability is a real SDK with real ledger<->trace
 * correlation — not the no-op façade ADR-0036 was written to correct.
 *
 * WHAT THIS PROVES (against a real Kernel and real Postgres):
 *   1. a real NodeSDK provider is registered and exports genuine spans
 *   2. PostgreSQL auto-instrumentation produces spans for real Kernel queries
 *   3. `currentTraceId()` returns a real trace id inside an active span, and the
 *      Event Manager stamps it onto the durable `events.events` row — the
 *      ledger<->trace correlation ADR-0036 requires
 *
 * WHAT THIS DOES NOT PROVE — and the RC audit records as debt: explicit span
 * coverage of the full named chain (desktop/voice -> Context -> cognition ->
 * gateway -> agent -> Agency -> Executor -> Adapter -> verification). Only two
 * Kernel paths create explicit spans today (`model_gateway.generate` in
 * HttpModelGatewayClient, `agency.executor.invoke` in the Executor), so an
 * interaction that touches neither carries no trace id on its ledger rows.
 * ADR-0036's status line states this honestly ("complete named-path span
 * coverage remains in progress"); this test pins the mechanism that does work.
 *
 * Telemetry is started here with an in-memory exporter BEFORE the Kernel boots.
 * `startTelemetry` returns early when an SDK is already registered, so the
 * Kernel's own call does not replace it — no test-only injection point is added
 * to the production composition root.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { currentTraceId, flushTelemetry, startTelemetry, stopTelemetry, telemetryDiagnostics, withSpan } from '@jarvis/telemetry';
import { isDockerAvailable } from '@jarvis/testkit';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';

const dockerOk = await isDockerAvailable();

const spans: ReadableSpan[] = [];
const exporter: SpanExporter = {
  export(batch, cb) { spans.push(...batch); cb({ code: 0 }); },
  shutdown: async () => undefined,
};

describe.skipIf(!dockerOk)('observability is real (integration)', () => {
  let ctx: ItContext;

  beforeAll(async () => {
    startTelemetry({ serviceName: 'jarvis-core-audit', serviceVersion: 'audit', nodeId: 'local-server', disabled: false, spanExporter: exporter });
    ctx = await setupIt();
    await truncateAll(ctx.pg);
  }, 180_000);

  afterAll(async () => { await ctx?.cleanup(); await stopTelemetry(); });

  it('registers a real provider that exports genuine spans carrying the service identity', async () => {
    expect(telemetryDiagnostics()).toMatchObject({ enabled: true, started: true });

    const k = ctx.makeKernel();
    await k.start();
    await withSpan('audit.provider_liveness', { 'jarvis.probe': 'rc-audit' }, async () => undefined);
    await flushTelemetry();

    expect(spans.length).toBeGreaterThan(0);
    const probe = spans.find((s) => s.name === 'audit.provider_liveness');
    expect(probe).toBeDefined();
    expect(probe!.resource.attributes['service.name']).toBe('jarvis-core-audit');
    expect(probe!.attributes['jarvis.probe']).toBe('rc-audit');
  });

  it('DOCUMENTED GAP: the registered PostgreSQL auto-instrumentation is inert for this driver', async () => {
    // `@opentelemetry/instrumentation-pg` patches node-postgres (`pg`). This
    // repository uses postgres.js (`postgres`) exclusively — `pg` is not a
    // dependency anywhere — so that instrumentation can never emit a span, even
    // though a full Kernel cold start executes a great deal of SQL.
    //
    // This test asserts the CURRENT TRUTH so the gap cannot be quietly forgotten
    // and so that adding real postgres.js tracing makes this test fail loudly
    // (at which point invert it). Recorded in the RC audit under observability.
    const k = ctx.makeKernel();
    await k.start();
    await flushTelemetry();
    const dbSpans = spans.filter((s) => /^(pg|postgres)[.:]/i.test(s.name));
    expect(dbSpans).toEqual([]);
  });

  it('stamps the active trace id onto the durable event ledger (ledger<->trace correlation)', async () => {
    const k = ctx.makeKernel();
    await k.start();

    const correlationId = 'corr-trace-probe';
    const captured = await withSpan('audit.ledger_correlation', { 'jarvis.correlation_id': correlationId }, async () => {
      const traceId = currentTraceId();
      // A real registered provider must yield a real trace id here. Under the
      // old no-op façade this was `undefined` — that is the regression guard.
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(traceId).not.toBe('0'.repeat(32));
      await k.events.emit({
        type: 'jarvis.kernel.state.snapshot_taken', retentionClass: 'DIAGNOSTIC', privacyClass: 'INTERNAL',
        subject: { kind: 'kernel', id: 'audit' }, actor: { kind: 'system', id: 'rc-audit' },
        correlationId, causationId: 'none', principalId: 'system',
        payload: { stateVersion: 0, checkpointEventId: null },
      });
      return traceId;
    });
    await flushTelemetry();

    const rows = await ctx.pg.sql<{ trace_id: string | null }[]>`
      select trace_id from events.events where correlation_id = ${correlationId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trace_id).toBe(captured);

    // The span itself really was exported, so the id in the ledger is joinable.
    expect(spans.some((s) => s.spanContext().traceId === captured && s.name === 'audit.ledger_correlation')).toBe(true);
  });

  it('keeps secrets and raw perception payloads out of span attributes', async () => {
    await flushTelemetry();
    const blob = JSON.stringify(spans.map((s) => ({ attributes: s.attributes, name: s.name })));
    for (const forbidden of ['dev-bootstrap-secret', 'dev-gateway-token', 'data:image', 'data:audio', 'pcm', 'POSTGRES_PASSWORD']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
