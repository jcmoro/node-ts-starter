import type { MiddlewareHandler } from 'hono';
import type { Metrics } from '../lib/metrics.ts';

const METRICS_PATH = '/metrics';

/**
 * Per-request Prometheus instrumentation: increments a counter and records
 * latency in a histogram. Critically labels the request by its **matched
 * route template** (e.g. `/users/:id`), not the literal path — labelling by
 * literal path with high-cardinality ids would explode the time series count.
 *
 * The /metrics scrape itself is skipped to avoid self-feedback.
 */
export function metricsMiddleware(metrics: Metrics): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === METRICS_PATH) {
      return next();
    }

    const start = performance.now();
    try {
      await next();
    } finally {
      const durationSeconds = (performance.now() - start) / 1000;

      // `routePath` is the matched template (e.g. /users/:id); falls back to
      // the literal path only when no route matched (404s on unknown paths).
      const route = c.req.routePath || c.req.path;

      const labels = {
        method: c.req.method,
        route,
        status_code: String(c.res.status),
      } as const;

      metrics.httpRequestsTotal.inc(labels);
      metrics.httpRequestDurationSeconds.observe(labels, durationSeconds);
    }
  };
}
