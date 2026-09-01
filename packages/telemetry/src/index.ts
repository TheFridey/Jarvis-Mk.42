/**
 * @jarvis/telemetry - tracing helpers.
 *
 * MK.43 NOTE: this uses `@opentelemetry/api` ONLY. Without a registered
 * TracerProvider the API returns no-op spans, so `withSpan` runs the callback
 * with zero overhead and `currentTraceId()` returns undefined. Wiring a real
 * SDK + OTLP exporter is a follow-up (the collector is already in the dev
 * stack). Telemetry is best-effort and on no critical path.
 */
import { context, SpanStatusCode, trace, type Span } from '@opentelemetry/api';

export { trace, context, SpanStatusCode };
export type { Span };

const TRACER_NAME = 'jarvis';

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  otlpEndpoint?: string;
  disabled?: boolean;
}

/** No-op in MK.43 (see file header). Kept so callers/wiring are stable. */
export function startTelemetry(_opts: TelemetryOptions): void {
  /* SDK registration deferred */
}

export async function stopTelemetry(): Promise<void> {
  /* nothing to flush without an SDK */
}

export function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/** Current active trace id, or undefined when no SDK/active span. */
export function currentTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  const id = span?.spanContext().traceId;
  return id && id !== '00000000000000000000000000000000' ? id : undefined;
}

/**
 * Run `fn` inside a span (a no-op span when no provider is registered). Records
 * exceptions + error status on throw, always ends the span.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
