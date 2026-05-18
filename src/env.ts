import { z } from 'zod';

// Treat "" (string vacío) como undefined. Necesario porque docker-compose
// resuelve `${VAR:-}` a "" cuando VAR no está set, y Zod considera "" un
// string válido que entonces falla en `.url()` o sobreescribe defaults.
const emptyStringToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database selection (precedence):
  //   1. DATABASE_URL set → Postgres (e.g. Supabase)
  //   2. otherwise        → SQLite at DATABASE_PATH (default :memory:)
  DATABASE_URL: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .url()
      .optional()
      .refine((u) => !u || u.startsWith('postgres://') || u.startsWith('postgresql://'), {
        message: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
      }),
  ),
  DATABASE_PATH: z.preprocess(emptyStringToUndefined, z.string().default(':memory:')),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;
