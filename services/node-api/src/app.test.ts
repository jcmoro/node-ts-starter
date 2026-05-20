import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from './app.ts';
import type { HealthCheck } from './db/health.ts';
import { createTestLogger } from './lib/logger.ts';
import { createMetrics } from './lib/metrics.ts';
import { createInMemoryUserRepository } from './repositories/user-repository.ts';

function buildApp(overrides: { health?: HealthCheck } = {}) {
  const userRepo = createInMemoryUserRepository();
  const logger = createTestLogger();
  const health: HealthCheck = overrides.health ?? { database: async () => {} };
  const metrics = createMetrics();
  const app = createApp({ userRepo, logger, health, metrics });
  return { app, userRepo, logger, health, metrics };
}

describe('GET /health', () => {
  it('returns 200 with status ok (does NOT touch the DB)', async () => {
    let dbCalls = 0;
    const health: HealthCheck = {
      database: async () => {
        dbCalls += 1;
      },
    };
    const { app } = buildApp({ health });
    const res = await app.request('/health');

    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'ok');
    assert.equal(dbCalls, 0);
  });
});

describe('GET /ready', () => {
  it('returns 200 when the DB responds', async () => {
    const { app } = buildApp();
    const res = await app.request('/ready');

    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'ready');
  });

  it('returns 503 when the DB throws', async () => {
    const failing: HealthCheck = {
      database: async () => {
        throw new Error('connection refused');
      },
    };
    const { app } = buildApp({ health: failing });
    const res = await app.request('/ready');

    assert.equal(res.status, 503);
    const body = (await res.json()) as { status: string; reason: string };
    assert.equal(body.status, 'not_ready');
    assert.equal(body.reason, 'database');
  });
});

describe('Request ID middleware', () => {
  it('generates an X-Request-Id header when none is provided', async () => {
    const { app } = buildApp();
    const res = await app.request('/health');

    const requestId = res.headers.get('x-request-id');
    assert.ok(requestId);
    assert.match(requestId, /^[0-9a-f-]{36}$/);
  });

  it('honours a valid incoming X-Request-Id', async () => {
    const { app } = buildApp();
    const res = await app.request('/health', {
      headers: { 'X-Request-Id': 'abc-123-def' },
    });

    assert.equal(res.headers.get('x-request-id'), 'abc-123-def');
  });

  it('rejects malicious X-Request-Id and generates a fresh one', async () => {
    const { app } = buildApp();
    const res = await app.request('/health', {
      headers: { 'X-Request-Id': 'has spaces and; semicolons' },
    });

    const requestId = res.headers.get('x-request-id');
    assert.ok(requestId);
    assert.notEqual(requestId, 'has spaces and; semicolons');
    assert.match(requestId, /^[0-9a-f-]{36}$/);
  });
});

describe('POST /users', () => {
  const post = (app: ReturnType<typeof createApp>, payload: unknown) =>
    app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  it('creates a user with a valid body', async () => {
    const { app } = buildApp();
    const res = await post(app, { email: 'jose@example.com', name: 'Jose' });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; email: string; name: string };
    assert.equal(body.email, 'jose@example.com');
    assert.equal(body.name, 'Jose');
    assert.match(body.id, /^[0-9a-f-]{36}$/);
  });

  it('returns 400 when email is invalid', async () => {
    const { app } = buildApp();
    const res = await post(app, { email: 'not-an-email', name: 'X' });
    assert.equal(res.status, 400);
  });

  it('returns 400 when name is empty', async () => {
    const { app } = buildApp();
    const res = await post(app, { email: 'jose@example.com', name: '' });
    assert.equal(res.status, 400);
  });

  it('returns 400 when body is missing both fields', async () => {
    const { app } = buildApp();
    const res = await post(app, {});

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: unknown };
    const serialised = JSON.stringify(body.error);
    assert.match(serialised, /email/);
    assert.match(serialised, /name/);
  });

  it('returns 409 when the email is already taken', async () => {
    const { app } = buildApp();
    const payload = { email: 'jose@example.com', name: 'Jose' };

    const first = await post(app, payload);
    assert.equal(first.status, 201);

    const second = await post(app, payload);
    assert.equal(second.status, 409);

    const body = (await second.json()) as { error: string };
    assert.match(body.error, /already/);
  });
});

describe('GET /metrics', () => {
  it('serves Prometheus text format with our HTTP metrics + node defaults', async () => {
    const { app } = buildApp();

    // Drive a couple of requests so our counters have something to expose.
    await app.request('/health');
    await app.request('/health');
    await app.request('/ready');

    const res = await app.request('/metrics');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);

    const body = await res.text();

    // Default process metrics from collectDefaultMetrics.
    assert.match(body, /^# HELP process_cpu_user_seconds_total/m);
    assert.match(body, /^# HELP nodejs_heap_size_total_bytes/m);

    // Our custom HTTP metrics with the expected labels.
    assert.match(body, /http_requests_total\{[^}]*route="\/health"[^}]*\} 2/);
    assert.match(body, /http_requests_total\{[^}]*route="\/ready"[^}]*\} 1/);
    assert.match(body, /http_request_duration_seconds_bucket\{[^}]*route="\/health"/);
  });

  it('does NOT record itself as a request (no self-feedback)', async () => {
    const { app } = buildApp();

    await app.request('/metrics');
    const res = await app.request('/metrics');
    const body = await res.text();

    // No /metrics line should appear in the counter.
    assert.equal(body.includes('route="/metrics"'), false);
  });

  it('isolates counters across createApp instances', async () => {
    const { app: appA } = buildApp();
    const { app: appB } = buildApp();

    await appA.request('/health');
    await appA.request('/health');

    const bodyB = await (await appB.request('/metrics')).text();
    // appB never saw any /health request — counter must be absent.
    assert.equal(bodyB.includes('route="/health"'), false);
  });
});
