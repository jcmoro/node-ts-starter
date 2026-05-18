import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../lib/logger.ts';

/**
 * Per-request logger. Emits a single structured log line per request with
 * method, path, status, and duration. Logs even when downstream code throws
 * (the error is handled by the global error handler; we still want the line).
 *
 * Deliberately does **not** log request bodies — that's where PII leaks live.
 * If you need audit-level logging, wire a separate middleware that opts in
 * per route.
 */
export function requestLoggerMiddleware(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    try {
      await next();
    } finally {
      const duration = Math.round(performance.now() - start);
      logger.info(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          duration_ms: duration,
        },
        'request',
      );
    }
  };
}
