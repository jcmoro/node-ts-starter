import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type Metrics = {
  /** Prometheus registry — pass to `/metrics` handler. */
  readonly registry: Registry;
  /** Total HTTP requests processed. Labels: method, route, status_code. */
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  /** HTTP request duration in seconds. Labels: method, route, status_code. */
  readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code'>;
};

/**
 * Build a fresh metrics bundle (registry + custom HTTP metrics + default
 * process/node metrics). Created per-process in production and per-test in
 * the test suite so suites don't bleed counters into each other.
 */
export function createMetrics(): Metrics {
  const registry = new Registry();

  // Default metrics ship process CPU, RSS, heap, GC, event loop lag, FDs.
  // Sampling is pull-based: each `registry.metrics()` call snapshots them.
  // No setInterval is started, so multiple registries in one process are safe.
  collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    // Buckets tuned for typical web latencies (5ms → 10s). Adjust per app.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  return { registry, httpRequestsTotal, httpRequestDurationSeconds };
}
