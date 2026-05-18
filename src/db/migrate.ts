import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PostgresClient } from './postgres.ts';

const MIGRATIONS_URL = new URL('../../migrations/', import.meta.url);

export type MigrationResult = { applied: string[] };

/**
 * Apply pending SQL migrations from /migrations.
 *
 * Migration files are plain .sql, executed in ascending filename order, each
 * wrapped in a transaction. Applied migrations are recorded in _migrations,
 * so re-running is idempotent.
 */
export async function migrate(sql: PostgresClient): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const dir = fileURLToPath(MIGRATIONS_URL);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');

    const existing = await sql<{ id: string }[]>`
      SELECT id FROM _migrations WHERE id = ${id}
    `;
    if (existing.length > 0) continue;

    const ddl = readFileSync(fileURLToPath(new URL(file, MIGRATIONS_URL)), 'utf-8');

    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx`INSERT INTO _migrations (id) VALUES (${id})`;
    });
    applied.push(id);
  }

  return { applied };
}
