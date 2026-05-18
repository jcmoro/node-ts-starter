import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openDatabase } from './db/connection.ts';
import {
  type HealthCheck,
  createPostgresHealthCheck,
  createSqliteHealthCheck,
} from './db/health.ts';
import { migrate } from './db/migrate.ts';
import { closePostgres, openPostgres } from './db/postgres.ts';
import { env } from './env.ts';
import { type Logger, createLogger } from './lib/logger.ts';
import { createMetrics } from './lib/metrics.ts';
import { createPostgresUserRepository } from './repositories/postgres-user-repository.ts';
import { createSqliteUserRepository } from './repositories/sqlite-user-repository.ts';
import type { UserRepository } from './repositories/user-repository.ts';

type Disposable = { close: () => void | Promise<void> };

type Bootstrapped = {
  userRepo: UserRepository;
  health: HealthCheck;
  disposable: Disposable;
};

async function bootstrap(logger: Logger): Promise<Bootstrapped> {
  if (env.DATABASE_URL) {
    const sql = openPostgres(env.DATABASE_URL);
    const { applied } = await migrate(sql);
    if (applied.length > 0) {
      logger.info({ migrations: applied }, 'applied migrations');
    }
    return {
      userRepo: createPostgresUserRepository(sql),
      health: createPostgresHealthCheck(sql),
      disposable: { close: () => closePostgres(sql) },
    };
  }

  const db = openDatabase(env.DATABASE_PATH);
  return {
    userRepo: createSqliteUserRepository(db),
    health: createSqliteHealthCheck(db),
    disposable: { close: () => db.close() },
  };
}

const logger = createLogger(env);
const metrics = createMetrics();
const { userRepo, health, disposable } = await bootstrap(logger);
const app = createApp({ userRepo, logger, health, metrics });

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  logger.info({ port }, 'listening');
});

async function shutdown(): Promise<void> {
  logger.info('shutting down');
  server.close();
  await disposable.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
