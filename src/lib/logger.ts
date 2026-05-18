import { trace } from '@opentelemetry/api';
import { type Logger, pino } from 'pino';
import type { Env } from '../env.ts';
import { getRequestId } from './request-context.ts';

export type { Logger };

/**
 * Build the application logger.
 *
 * - In development: pretty-printed, colourised, human-readable.
 * - Everywhere else: NDJSON to stdout (one log per line). Docker, k8s, and
 *   log aggregators (Loki, Datadog) consume this natively.
 *
 * `mixin` runs on every log call and merges:
 *   - `requestId` from our AsyncLocalStorage (set by request-id middleware)
 *   - `traceId` / `spanId` from the active OpenTelemetry span (if any)
 *
 * Including the OTel context makes logs trivially correlatable with traces in
 * any modern UI (Grafana/Tempo, Honeycomb, Datadog). When the OTel SDK isn't
 * loaded — typical in tests — `trace.getActiveSpan()` returns undefined and
 * we simply don't add the trace fields.
 */
export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    mixin: () => {
      const fields: { requestId?: string; traceId?: string; spanId?: string } = {};

      const requestId = getRequestId();
      if (requestId) fields.requestId = requestId;

      const spanCtx = trace.getActiveSpan()?.spanContext();
      if (spanCtx) {
        fields.traceId = spanCtx.traceId;
        fields.spanId = spanCtx.spanId;
      }

      return fields;
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

/** Silent logger for use in tests — discards all output. */
export function createTestLogger(): Logger {
  return pino({ level: 'silent' });
}
