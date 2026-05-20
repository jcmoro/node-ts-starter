// Standalone migration runner. Usage:
//   node --experimental-strip-types --env-file=.env src/db/cli.ts migrate
//   npm run migrate
//
// Reads DATABASE_URL from the environment (validated via env.ts) and applies
// any pending migrations from /migrations.

import { env } from '../env.ts';
import { migrate } from './migrate.ts';
import { closePostgres, openPostgres } from './postgres.ts';

const command = process.argv[2];

if (command !== 'migrate') {
  console.error('Usage: cli.ts migrate');
  process.exit(2);
}

if (!env.DATABASE_URL) {
  console.error(
    'DATABASE_URL not set; nothing to migrate (SQLite uses CREATE TABLE IF NOT EXISTS)',
  );
  process.exit(0);
}

const sql = openPostgres(env.DATABASE_URL);
try {
  const { applied } = await migrate(sql);
  if (applied.length === 0) {
    console.log('No pending migrations.');
  } else {
    console.log(`Applied ${applied.length} migration(s):`);
    for (const id of applied) console.log(`  - ${id}`);
  }
} finally {
  await closePostgres(sql);
}
