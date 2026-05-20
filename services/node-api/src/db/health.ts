import type { DatabaseSync } from 'node:sqlite';
import type { PostgresClient } from './postgres.ts';

/**
 * A backend-agnostic health probe. Implementations should be cheap (single
 * round-trip) and **throw** if the database is unreachable. The /ready
 * handler decides whether to map that to a 503 or surface details.
 */
export type HealthCheck = {
  database(): Promise<void>;
};

export function createSqliteHealthCheck(db: DatabaseSync): HealthCheck {
  return {
    async database() {
      db.prepare('SELECT 1').get();
    },
  };
}

export function createPostgresHealthCheck(sql: PostgresClient): HealthCheck {
  return {
    async database() {
      await sql`SELECT 1`;
    },
  };
}
