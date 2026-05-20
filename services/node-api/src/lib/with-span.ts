import { type Attributes, type Span, SpanStatusCode, trace } from '@opentelemetry/api';

// One tracer per logical "instrumented surface". For a single-service app a
// single named tracer is enough; in a monorepo you'd typically have one per
// package so spans carry where they originated.
const tracer = trace.getTracer('node-ts-starter');

/**
 * Run `fn` inside a span. Records exceptions, marks the span as ERROR, and
 * always closes the span — even on throw.
 *
 * Safe to call without an active SDK: `trace.getTracer` returns a no-op tracer
 * when OpenTelemetry hasn't been started (the typical situation in tests).
 * The span methods are no-ops and `fn` runs normally.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) span.setAttributes(attributes);
    try {
      return await fn(span);
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
