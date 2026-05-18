import postgres, { type Sql } from 'postgres';

export type PostgresClient = Sql;

export function openPostgres(url: string): PostgresClient {
  return postgres(url, {
    // Reasonable defaults for a long-lived Node server. Supabase free tier
    // allows up to ~60 concurrent connections; staying well under is polite.
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Use prepared statements for performance. Disable if you're behind the
    // Supabase pooler in *transaction* mode (it doesn't support them).
    prepare: true,
    // Suppress NOTICE-level messages from idempotent DDL (CREATE TABLE IF NOT
    // EXISTS, etc). Real warnings/errors still surface via thrown exceptions.
    onnotice: () => undefined,
  });
}

export async function closePostgres(sql: PostgresClient): Promise<void> {
  await sql.end({ timeout: 5 });
}
