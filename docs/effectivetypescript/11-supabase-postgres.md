# 11 — Postgres (Supabase) por conexión directa

## El problema

SQLite era perfecto para aprender. Para una app real con varios procesos o un deploy hospedado, necesitas un **Postgres gestionado**. Las opciones razonables hoy:

| Proveedor       | Tier gratis      | Notas                                          |
|-----------------|------------------|-----------------------------------------------|
| **Supabase**    | 500 MB, ilimitadas conexiones via pooler | Postgres + auth + storage + realtime |
| **Neon**        | 3 GB, suspende inactivo | Postgres serverless, branches por feature |
| **Railway**     | $5/mes "hobby"   | Postgres + deploys, todo en uno              |
| **RDS / Cloud SQL** | Pago desde día 1 | Producción seria                          |

Vamos con **Supabase**: tier gratis generoso, dashboard pulido, y bonus features (auth, RLS, realtime) por si más adelante. Pero — y esto es importante — vamos a tratarlo como **Postgres a secas**, no usar el SDK de Supabase.

## La decisión: SDK vs conexión directa

Cuando buscas "Supabase + Node + TypeScript" verás dos enfoques:

### A — `@supabase/supabase-js` (el SDK)

```ts
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { data, error } = await supabase.from('users').select('*');
```

Por debajo es **PostgREST** (REST sobre Postgres), no SQL directo. Está diseñado para:

- **Apps frontend-first**: el navegador habla con Supabase directamente, **Row Level Security** hace de capa de autorización.
- **Apps full-stack con Supabase Auth**: el `user_id` viaja en el JWT, RLS filtra automáticamente.

### B — Conexión directa a Postgres

```ts
import postgres from 'postgres';
const sql = postgres(DATABASE_URL);
const users = await sql`SELECT * FROM users`;
```

Tratas a Supabase como **un Postgres hospedado**. Tu backend sigue siendo backend, tus capas siguen siendo capas, el `UserRepository` simplemente gana una nueva implementación.

### Cuál corresponde a este proyecto

Hemos construido **un backend con servicios + repositorios + Result**. El SDK desplazaría todas esas capas (el cliente pasaría a ser PostgREST). Sería tirar lo del capítulo 07 a la basura.

**Conexión directa**. Es senior-correcto cuando ya tienes un backend de verdad. El SDK gana cuando la arquitectura es "frontend → Supabase" sin backend intermedio.

> 💡 **Cuándo SÍ usar el SDK**: prototipos sin backend; apps web/móviles con RLS bien diseñado; cuando quieres realtime subscriptions desde el cliente. No es nuestro caso.

## El driver: `postgres` (porsager)

```bash
npm install postgres
```

Hay tres clientes Postgres serios en Node:

| Librería         | Estilo                 | Cuándo                         |
|------------------|------------------------|--------------------------------|
| **`postgres`**   | Tagged templates, ESM-first | Default moderno. **Nuestra elección.** |
| **`pg`**         | API clásica (Pool, Client) | Compatibilidad con código viejo |
| **`kysely`** / **`drizzle`** | Query builder TS  | Cuando los queries crecen y quieres tipado fuerte |

`postgres` brilla por:

- **Tagged templates con parametrización automática**:
  ```ts
  await sql`SELECT * FROM users WHERE id = ${id}`;
  ```
  El `${id}` no se interpola — pasa como parámetro real al protocolo Postgres. **Imposible de inyectar**.

- **ESM-first, sin callbacks**. Todo es `await`.

- **~50 KB**. Ligero, sin tipos generados ni gymnastics de TypeScript.

- **Prepared statements automáticos** (los desactivamos solo para el pooler de Supabase en modo transaction).

## El repositorio Postgres

`src/repositories/postgres-user-repository.ts`:

```ts
import type { PostgresClient } from '../db/postgres.ts';
import { UserSchema } from '../domain/user.ts';
import type { UserRepository } from './user-repository.ts';

export function createPostgresUserRepository(sql: PostgresClient): UserRepository {
  return {
    async findByEmail(email) {
      const rows = await sql`
        SELECT id, email, name FROM users WHERE email = ${email}
      `;
      if (rows.length === 0) return null;
      return UserSchema.parse(rows[0]);
    },

    async save(user) {
      await sql`
        INSERT INTO users (id, email, name)
        VALUES (${user.id}, ${user.email}, ${user.name})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      `;
    },
  };
}
```

Misma firma exacta que `createSqliteUserRepository` del capítulo 08. **Misma interfaz `UserRepository`**. El servicio (`createUser`), el handler (`POST /users`), y los tests del service: **cero cambios**.

Esto es lo que prometía el capítulo 07: cambiar de SQLite a Postgres es **añadir un archivo**. Nada más se mueve.

### El detalle que recordar: `UserSchema.parse(rows[0])`

```ts
const rows = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
if (rows.length === 0) return null;
return UserSchema.parse(rows[0]);
```

`rows` es un array genérico. Cada fila es prácticamente `unknown`. Pasar la fila por `UserSchema.parse()`:

1. **Valida** que tenga `id`, `email`, `name` con los tipos esperados.
2. **Aplica los brands** del capítulo 06: el `string` se convierte en `Email`, `UserId`, `NonEmptyString`.

Exactamente igual que con SQLite. **El borde con la DB es un borde como cualquier otro**.

## Migraciones (de verdad)

Con SQLite usamos `CREATE TABLE IF NOT EXISTS` al arrancar. Con Postgres multi-instancia esto **no escala**: dos instancias arrancando simultáneamente podrían colisionar, y el día que añadas una columna, no hay forma elegante de migrar.

Necesitamos **migraciones versionadas**. Patrón senior universal:

1. Archivos `0001_xxx.sql`, `0002_yyy.sql` en una carpeta `migrations/`.
2. Tabla `_migrations` en la DB que registra cuáles ya se aplicaron.
3. Un runner que: lee los archivos, ve cuáles faltan, los aplica **en transacción**, registra.

Nuestro runner (`src/db/migrate.ts`, ~40 líneas):

```ts
export async function migrate(sql: PostgresClient): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const existing = await sql`SELECT id FROM _migrations WHERE id = ${id}`;
    if (existing.length > 0) continue;

    const ddl = readFileSync(/* ... */, 'utf-8');
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx`INSERT INTO _migrations (id) VALUES (${id})`;
    });
    applied.push(id);
  }

  return { applied };
}
```

Tres detalles que pagan:

- **`sql.begin`** — transacción. Si el DDL falla, no se registra en `_migrations` (atomicidad).
- **`tx.unsafe(ddl)`** — el DDL es un string entero, no se puede parametrizar columnas/tablas. `unsafe` es la API explícita para "sé lo que hago".
- **`ORDER BY filename ascending`** — el orden importa. Por eso los nombres son `0001_`, `0002_`, etc. **Nunca renumeres** una vez aplicada en producción.

### Reglas inviolables de migraciones

1. **Una migración aplicada es inmutable**. Si te equivocaste, crea otra que arregle.
2. **Cada migración debe ser idempotente o transaccional**. Si crashea a mitad, debe poder reintentarse.
3. **Test las migraciones en staging antes de prod**. SQL es traicionero.
4. **No metas datos en una migración de schema**. `INSERT` va en seed scripts separados (excepto valores enum estables como rol de "admin").

> 💡 **Cuándo subir a un tool real** (node-pg-migrate, kysely-migrator, dbmate, atlas, sqitch): cuando necesites rollbacks automáticos, diffing de schemas, o seeding complejo. Nuestro runner casero es perfecto hasta ~20 migraciones.

## El dispatcher en `index.ts`

```ts
async function bootstrap(): Promise<{ userRepo: UserRepository; disposable: Disposable }> {
  if (env.DATABASE_URL) {
    const sql = openPostgres(env.DATABASE_URL);
    const { applied } = await migrate(sql);
    if (applied.length > 0) {
      console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }
    return {
      userRepo: createPostgresUserRepository(sql),
      disposable: { close: () => closePostgres(sql) },
    };
  }

  const db = openDatabase(env.DATABASE_PATH);
  return {
    userRepo: createSqliteUserRepository(db),
    disposable: { close: () => db.close() },
  };
}
```

Patrón **discriminado por env**:

- `DATABASE_URL` set → Postgres (migra + conecta).
- Sin `DATABASE_URL` → SQLite (compat hacia atrás).

Esto te permite:

- **Tests unitarios rápidos**: in-memory SQLite, sin docker.
- **Dev local**: SQLite con archivo, o Postgres local en compose.
- **Producción**: Postgres en Supabase, configurado por env.

**Cero código duplicado**. Los handlers y servicios no se enteran.

## Conexión a tu Supabase

### Paso 1 — Obtener la connection string

En el dashboard de tu proyecto Supabase:

1. **Project Settings** (icono de engranaje, abajo izquierda).
2. **Database** → sección **Connection string**.
3. Elige el tab **URI**.
4. Verás dos opciones:
   - **Direct connection** (puerto 5432). Para servidores long-lived como el nuestro.
   - **Transaction pooler** (puerto 6543, hostname `pooler.supabase.com`). Para serverless (Lambda, Vercel functions, Edge).

5. Copia la URI. Tendrá la forma:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
6. Sustituye `[YOUR-PASSWORD]` por el password que pusiste al crear el proyecto. **Si no lo recuerdas**: Database → Reset database password.

### Paso 2 — Ponerlo en `.env`

```bash
DATABASE_URL=postgresql://postgres:tu-password@db.gvnlghsckmhrcptimoro.supabase.co:5432/postgres
```

**Nunca commitees `.env`** — ya está en `.gitignore`.

### Paso 3 — Aplicar la migración

```bash
make migrate
```

Verás:

```
Applied 1 migration(s):
  - 0001_initial
```

### Paso 4 — Arrancar

```bash
make dev-api
# o el stack completo:
make up
```

Y el servidor estará escribiendo en tu Supabase real. Pruébalo:

```bash
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"jose@example.com","name":"Jose"}'
```

En el dashboard de Supabase → **Table Editor** → `users` → verás la fila.

## Dev local sin Supabase: Postgres en compose

Para no depender de internet ni de tu free tier en desarrollo, `docker-compose.dev.yml` levanta un Postgres local:

```bash
make up-dev
# postgres en localhost:55432
# api  en localhost:3000 (conectado al pg local)
# web  en localhost:5173 (Vite)
```

O solo la DB para tests:

```bash
make db-up      # arranca solo el postgres
make test-postgres  # corre los tests contra él
make db-down    # bájalo
```

## Pooler vs Direct: cuándo cuál

| Caso                          | Recomendado          | Por qué                                            |
|-------------------------------|----------------------|----------------------------------------------------|
| Server Node long-lived (este) | **Direct** (5432)    | Mantiene conexiones abiertas, prepared statements  |
| Lambda / Vercel function      | **Transaction pooler** (6543) | Cada invocation abre/cierra; pooler reutiliza |
| Edge Runtime                  | **Session pooler** (5432 vía pooler.supabase.com) | Compat HTTP/WebSocket sin TCP directo |

Si vas a pooler en **modo transaction**, desactiva prepared statements:

```ts
postgres(url, { prepare: false })
```

(El pooler PgBouncer en transaction mode no soporta prepared statements porque comparte conexiones entre transacciones.)

## Trampas comunes

### 1. La password con caracteres raros

Si tu password tiene `@`, `:`, `/` o `?`, debes **URL-encodear**. Ejemplo: `Pa$$w@rd!` → `Pa%24%24w%40rd%21`. O cambia el password a algo solo alfanumérico (recomendado).

### 2. SSL no negociado

Supabase **requiere SSL**. El driver `postgres` lo detecta del URL automáticamente si dice `?sslmode=require`. Si te falla con `connection refused`, añádelo:

```
DATABASE_URL=postgresql://...?sslmode=require
```

### 3. Connection limit

El tier gratis de Supabase: ~60 conexiones directas (puerto 5432). Cada instancia de tu app abre `max: 10` (lo que configuramos en `postgres.ts`). Si vas a tener más de 6 instancias, **usa el pooler**.

### 4. RLS activo sin policy

Si activas Row Level Security en una tabla **sin policies**, todos los SELECT devuelven 0 filas — incluso desde tu backend con la URL `postgres://postgres:...`. La mitigación: o desactiva RLS para tablas server-managed, o crea una policy para el rol `postgres`/`service_role`.

Para este proyecto: **RLS off** en `users`. Es tu backend quien autoriza.

### 5. Olvidar el `await sql.end()` al apagar

Si el proceso muere con conexiones abiertas, Supabase las verá ocupadas hasta el timeout (~5min). Por eso el `index.ts` tiene `await disposable.close()` en `SIGINT`/`SIGTERM`.

### 6. `prepare: true` detrás del pooler de transaction

```
error: bind message has X parameter formats but Y parameters
```

El pooler en transaction mode reparte una misma conexión entre transacciones. Los prepared statements son por conexión, así que rotan y se rompen. Solución: `prepare: false`.

### 7. Migraciones aplicadas sin transacción

Algunas operaciones DDL en Postgres **no son transaccionables** (CREATE INDEX CONCURRENTLY). El runner las falla. Solución: marcar la migración como "no-tx" o usar un tool más serio. Trampa rara, pero pasa.

### 8. `SELECT *` y caída en cascada

Si haces `SELECT *` y tu Zod schema es estricto, cualquier columna añadida más adelante hace **fallar** el parse. Recomendación: **siempre `SELECT col1, col2, col3`** explícito. El compilador y el schema son tu seguro.

## Comparación con el SDK de Supabase

```ts
// SDK
const { data, error } = await supabase
  .from('users')
  .select('id, email, name')
  .eq('email', email)
  .maybeSingle();

// Conexión directa
const rows = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
```

| Dimensión          | SDK (PostgREST)              | Conexión directa             |
|--------------------|------------------------------|------------------------------|
| Sintaxis           | Method chaining              | SQL puro                     |
| Auth implícita     | Sí (JWT + RLS)               | No (la haces tú)             |
| Joins complejos    | Con `select('*, posts(*)')`  | SQL como toda la vida        |
| Migraciones        | Dashboard o supabase-cli     | Tu pipeline                  |
| Realtime subs      | Built-in                     | Necesitas `LISTEN/NOTIFY`    |
| Tipos              | Generados con `supabase gen` | Manuales / desde schema      |
| Aprendizaje SQL    | Lo escondes                  | Lo expones                   |

Para **aprender backend + TS**: directa. Para **moverte rápido en un MVP**: SDK.

## Ejercicio

1. **Connecta tu Supabase**: sigue los pasos del capítulo, rellena `DATABASE_URL` en `.env`, ejecuta `make migrate` y `make dev-api`. Crea un user con `curl` y verifícalo en el dashboard.

2. **Añade `created_at`**: crea `migrations/0002_add_created_at.sql` con `ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`. Actualiza `UserSchema` para que tipa `createdAt: z.date()` (¡ojo a snake_case ↔ camelCase!). Aplica con `make migrate`.

3. **Reto — Mapping snake_case ↔ camelCase**: Postgres es `email_address`, TS es `emailAddress`. Implementa un helper que transforme las claves al pasar por `parse`. Pista: `postgres` tiene `transform: { undefined: null, column: { from: postgres.camel, to: postgres.snake } }`.

4. **Reto — Contract tests reutilizables**: extrae los tests de `InMemoryUserRepository`, `SqliteUserRepository`, y `PostgresUserRepository` a una función `runUserRepositoryContractTests(makeRepo)`. Llámala desde tres archivos. Confirma que **el mismo cuerpo de tests** pasa contra los tres backends. Este era el ejercicio del capítulo 08 — ahora con tres impls tiene aún más sentido.

5. **Reto — RLS y service role**: activa RLS en `users` desde el dashboard. Reset DB y observa que los SELECT desde tu backend devuelven 0 filas. Conéctate con la URL `service_role` (Settings → Database → URI con el password del service_role). Verifica que con esa, los SELECT funcionan. ¿Cuál es la diferencia de capacidades?

6. **Reto — Connection pool monitoring**: instrumenta `openPostgres` para exponer `pool.size`, `pool.idle`, `pool.queued` via `GET /metrics`. Pista: el cliente `postgres` no expone esto directamente; tendrás que envolverlo o usar `LISTEN pg_stat_activity`.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 30 — *Be Liberal in What You Accept and Strict in What You Produce*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/loose-accept-strict-produce.md)** — el repo Postgres recibe filas crudas (liberal) y devuelve `User` (estricto). Mismo principio del cap. 03 y 08, ahora cruzando otro borde.
- **[Item 35 — *Prefer More Precise Alternatives to String Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/avoid-strings.md)** — `UserSchema.parse(row)` no solo valida — **re-aplica los brands** del cap. 06. Sin esto, el `email` que sale del SELECT volvería a ser `string` pelado.
- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — `UserRepository`, `createPostgresUserRepository`, `migrate`: el lenguaje del proyecto, no del driver SQL.
- **[Item 74 — *Know How to Reconstruct Types at Runtime*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/runtime-types.md)** — ya el principio rector. Cualquier borde con el exterior (HTTP, DB, queue, archivo) pasa por un schema.

---

**Anterior:** [10 — Docker, Compose, Biome y Makefile](./10-docker-y-tooling.md)
**Siguiente:** [12 — Error handling estructurado y observabilidad](./12-error-handling-y-observabilidad.md)
