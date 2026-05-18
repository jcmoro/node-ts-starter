import { Hono } from 'hono';
import { z } from 'zod';
import type { HealthCheck } from './db/health.ts';
import { CreateUserSchema } from './domain/user.ts';
import type { Logger } from './lib/logger.ts';
import type { Metrics } from './lib/metrics.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { metricsMiddleware } from './middleware/metrics.ts';
import { requestIdMiddleware } from './middleware/request-id.ts';
import { requestLoggerMiddleware } from './middleware/request-logger.ts';
import type { UserRepository } from './repositories/user-repository.ts';
import { type UserError, createUser } from './services/user-service.ts';

export type AppDeps = {
  userRepo: UserRepository;
  logger: Logger;
  health: HealthCheck;
  metrics: Metrics;
};

function assertNever(x: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(x)}`);
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // Cross-cutting middleware. Order matters:
  //   1. requestId — must run before anything that logs or labels metrics.
  //   2. logger    — wraps the request to log even on throws.
  //   3. metrics   — records counter + histogram per request (after status known).
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(deps.logger));
  app.use(metricsMiddleware(deps.metrics));

  // Liveness: "the process is alive". MUST NOT touch the DB.
  // Touching the DB here makes a DB outage cascade into pod restarts.
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Readiness: "I can serve traffic". Probes the database. Returns 503
  // if the DB is unreachable so the load balancer can drain this instance.
  app.get('/ready', async (c) => {
    try {
      await deps.health.database();
      return c.json({ status: 'ready' });
    } catch (err) {
      deps.logger.warn({ err }, 'readiness check failed');
      return c.json({ status: 'not_ready', reason: 'database' }, 503);
    }
  });

  // Prometheus scrape endpoint. Exposes process metrics + HTTP histograms.
  // Not labelled/timed by metricsMiddleware itself (avoid self-feedback).
  app.get('/metrics', async (c) => {
    c.header('Content-Type', deps.metrics.registry.contentType);
    return c.body(await deps.metrics.registry.metrics());
  });

  app.post('/users', async (c) => {
    const body = await c.req.json();
    const parsed = CreateUserSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: z.treeifyError(parsed.error) }, 400);
    }

    const result = await createUser(deps.userRepo, parsed.data);

    if (!result.ok) {
      const error: UserError = result.error;
      switch (error.kind) {
        case 'email_already_taken':
          return c.json({ error: 'email already taken' }, 409);
        default:
          return assertNever(error.kind);
      }
    }

    return c.json(result.value, 201);
  });

  // Global error handler — catches anything that escapes a handler.
  app.onError(errorHandler(deps.logger));

  return app;
}
