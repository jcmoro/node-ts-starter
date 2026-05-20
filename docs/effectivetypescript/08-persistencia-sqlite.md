# 08 — Persistencia real con `node:sqlite`

## El problema

`createInMemoryUserRepository` pierde todo al reiniciar. Para un test es perfecto; para producción es inservible.

Necesitamos persistencia **real**. Opciones para un proyecto Node:

| Backend       | Cuándo                                              |
|---------------|-----------------------------------------------------|
| **SQLite**    | Single-node, embebido, prototipos, dev local, CLIs  |
| **PostgreSQL**| Producción seria, multi-cliente, features avanzadas |
| **MongoDB**   | Datos sin schema estricto, documentos               |
| **Redis**     | Cache, queues, datos efímeros                       |

Para **aprender los patrones** y para apps pequeñas, SQLite es ideal. Y desde Node 22.5, viene un cliente **en stdlib** (`node:sqlite`) — cero dependencias.

> 💡 **Por qué SQLite es serio**: corre tu navegador, tu iPhone, miles de apps en producción. Es **la base de datos más desplegada del mundo**. Solo no escala horizontalmente (un único proceso escribe). Para todo lo demás, perfecto.

## `node:sqlite` en 30 segundos

```ts
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
  );
`);

const insert = db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)');
insert.run('abc', 'jose@example.com', 'Jose');

const find = db.prepare('SELECT * FROM users WHERE email = ?');
const row = find.get('jose@example.com');
// row: { id: 'abc', email: 'jose@example.com', name: 'Jose' } (o undefined)
```

Tres cosas a destacar:

1. **`DatabaseSync` es síncrono**. No hay `await db.prepare(...)`. Esto es por diseño — SQLite es lo bastante rápido para que la asincronía añada más overhead del que evita. Lo verás también en `better-sqlite3` (la librería community equivalente, más madura).
2. **`prepare` cachea el plan de query**. Reutilizar `prepare` es **mucho más rápido** que llamar a `db.exec(sql)` cada vez.
3. **Las filas son `unknown`**. SQLite no sabe TS. El row que sale es genérico — y aquí entran los schemas Zod otra vez.

> 💡 **`DatabaseSync` vs async**: hay otra clase llamada `DatabaseAsync` en proyectos. Para SQLite **siempre prefieres sync**: el I/O es local, latencia microsegundos, hacer un round-trip al event loop por cada query no compensa. Para Postgres/Mongo, async sí.

## Mapping de filas a tipos branded

Aquí está el punto donde **todo lo del capítulo 06 paga**.

Cuando `find.get(email)` te devuelve la fila, su tipo es algo como `{ [key: string]: unknown } | undefined`. **No** es un `User`. Necesitas validarlo:

```ts
async findByEmail(email) {
  const row = findStmt.get(email);
  if (!row) return null;
  return UserSchema.parse(row); // 🎯 row: unknown → User (con brands)
}
```

`UserSchema.parse(row)`:

1. Valida que `id` es un UUID → lo convierte en `UserId`.
2. Valida que `email` es un email → lo convierte en `Email` (con trim/lowercase, porque el schema los aplica).
3. Valida que `name` es non-empty → lo convierte en `NonEmptyString`.

**El borde con la DB es exactamente igual de borde que el borde con HTTP.** Datos que vienen de fuera del sistema de tipos → schema → datos tipados internamente. Misma idea, misma solución.

> 💡 Si has trabajado con ORMs (Hibernate, Doctrine, GORM, SQLAlchemy), esto te puede chocar: **estamos validando explícitamente cada fila**. Sí. Es deliberado. ORMs hacen mappings "mágicos" que rompen cuando el schema de DB y el modelo divergen. Aquí Zod te avisa al instante.

## Migraciones (simple)

Para este proyecto, una migración consiste en ejecutar `CREATE TABLE IF NOT EXISTS` al abrir la DB:

```ts
// src/db/connection.ts
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
  `);
  return db;
}
```

**Esto funciona** para crear la tabla la primera vez. Pero no maneja **cambios**: si mañana añades una columna `created_at`, ¿cómo actualizas DBs existentes?

Para esto se usan **migration runners**:

- **Migrations versionadas**: archivos `001_create_users.sql`, `002_add_created_at.sql`, etc. Una tabla `_migrations` registra cuáles se han aplicado.
- **Herramientas**: `node-pg-migrate`, `knex migrations`, `kysely`'s migrator, `drizzle-kit`. Para SQLite hay `umzug` o un script propio (~50 líneas).

En este proyecto **simplificamos** con `CREATE TABLE IF NOT EXISTS` porque solo hay una migración. **No hagas esto en producción** — el día que añadas un campo, te pegarás con la cara contra la pared.

> 💡 **Patrón mínimo de versioning sin librería**: usar `PRAGMA user_version` de SQLite (un número entero almacenado en el archivo). Lees el version, ejecutas las migraciones desde ese punto, incrementas. ~30 líneas de código.

## El repositorio SQLite

`src/repositories/sqlite-user-repository.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { UserSchema, type User } from '../domain/user.ts';
import type { UserRepository } from './user-repository.ts';

export function createSqliteUserRepository(db: DatabaseSync): UserRepository {
  const findStmt = db.prepare('SELECT id, email, name FROM users WHERE email = ?');
  const saveStmt = db.prepare(
    `INSERT INTO users (id, email, name) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name`
  );

  return {
    async findByEmail(email) {
      const row = findStmt.get(email);
      if (!row) return null;
      return UserSchema.parse(row);
    },
    async save(user) {
      saveStmt.run(user.id, user.email, user.name);
    },
  };
}
```

Comentarios:

- **`prepare` se llama UNA VEZ**, fuera del closure de los métodos. Esto cachea el plan y reutiliza el statement. Llamadas posteriores a `.get()` o `.run()` son rapidísimas.
- **`ON CONFLICT(email) DO UPDATE`** = upsert. Replica el comportamiento de `Map.set` de la versión in-memory: si el email ya existe, actualiza el nombre.
- **`async findByEmail`** aunque `findStmt.get` es **síncrono**. Hacemos la firma async para cumplir la interface `UserRepository`. Si en el futuro cambias a Postgres async, no rompes nada.
- **`UserSchema.parse` puede lanzar** si la fila está corrupta (no debería pasar, las constraints lo evitan). Si lanzara, es un bug del sistema (no de los datos del usuario) — un `throw` es razonable aquí.

## Por qué AHORA el `interface` paga

Mira `src/services/user-service.ts`. Tiene **cero cambios**. El service recibe un `UserRepository`. No sabe si es in-memory, SQLite, o un mock. La lógica de negocio es la misma.

Mira `src/app.ts`. **Cero cambios**. `createApp({ userRepo })` no le importa qué hay detrás.

El **único** sitio donde decides "ahora persisto en SQLite" es **`src/index.ts`**:

```ts
import { openDatabase } from './db/connection.ts';
import { createSqliteUserRepository } from './repositories/sqlite-user-repository.ts';

const db = openDatabase(env.DATABASE_PATH);
const userRepo = createSqliteUserRepository(db);
const app = createApp({ userRepo });
```

**Esto** es el ROI del layering del capítulo 07. Cambiar de backend de datos: una línea en el composition root.

> 💡 **Comparación con frameworks pesados**: en Spring, lo mismo se hace con `@Configuration` y `@Bean` perfilados (`@Profile("dev")` vs `@Profile("prod")`). Más declarativo, más verboso. Aquí: una `if (env.NODE_ENV === 'production')` en `index.ts` y listo.

## Connection management

Una conexión por proceso. Abrir al arrancar, cerrar al apagar:

```ts
// src/index.ts (pattern, no en el repo actual)
const db = openDatabase(env.DATABASE_PATH);
const userRepo = createSqliteUserRepository(db);
const app = createApp({ userRepo });

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`listening on http://localhost:${port}`);
});

process.on('SIGINT', () => {
  console.log('shutting down...');
  server.close();
  db.close();
  process.exit(0);
});
```

Con SQLite síncrono, **no necesitas pool de conexiones**. Una sola conexión basta porque los writes están serializados por SQLite. Con Postgres, sí — verás `pg.Pool` o equivalente.

## Transacciones

Cuando una operación necesita atomicidad (varios inserts que deben ir juntos):

```ts
db.exec('BEGIN');
try {
  insertA.run(...);
  insertB.run(...);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
```

O con un helper:

```ts
function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

tx(db, () => {
  insertA.run(...);
  insertB.run(...);
});
```

Como `DatabaseSync` es sync, el helper es sync — no necesitas `try/await/finally`. Limpio.

## Testing con `:memory:`

SQLite acepta el path mágico `:memory:` — DB **efímera**, solo existe mientras el proceso vive. Perfecto para tests:

```ts
function makeRepo() {
  const db = openDatabase(':memory:');
  return createSqliteUserRepository(db);
}

describe('SqliteUserRepository', () => {
  it('persists and retrieves a user', async () => {
    const repo = makeRepo();
    // ...
  });
});
```

Cada test tiene **su propia DB**, fresca, aislada. No hay cleanup. No hay race conditions entre tests paralelos. Velocidad: ~1ms por DB nueva.

> 💡 Pattern útil: **contract tests**. Como ambos repos (in-memory y SQLite) implementan `UserRepository`, **el mismo conjunto de tests** debería pasar contra cualquiera. Lo dejamos como ejercicio porque requiere un poco de refactor.

## Trampas comunes

### 1. Llamar a `.prepare()` en cada query

```ts
async findByEmail(email) {
  const stmt = db.prepare('SELECT ...'); // ❌ se compila cada vez
  return stmt.get(email);
}
```

**Mata el rendimiento**. Prepara una vez, fuera del closure, y reutiliza.

### 2. Confiar en que la fila tipa como el row

```ts
async findByEmail(email) {
  const row = findStmt.get(email) as User; // ❌ mentira
  return row;
}
```

`find.get` devuelve `unknown`. Castear sin validar es **exactamente el problema** que branded types y Zod resuelven. Si el schema cambia y olvidaste actualizar el `as`, en runtime tendrás un objeto malformado paseándose como `User`.

### 3. SQLite y tipos numéricos

SQLite tiene **type affinity**, no tipos estrictos. Un campo `INTEGER` puede contener `'42'` (string) si lo insertas así. Las consultas devuelven `number | string | bigint` según el caso. Si tu schema espera `number`, **valida**.

### 4. Bind parameters posicionales vs nombrados

```ts
// Posicionales
const stmt = db.prepare('SELECT * FROM users WHERE id = ? AND active = ?');
stmt.get('abc', 1);

// Nombrados
const stmt = db.prepare('SELECT * FROM users WHERE id = $id AND active = $active');
stmt.get({ id: 'abc', active: 1 });
```

Posicionales son más cortos. Nombrados son más legibles con muchos params. Recomendación: **posicionales hasta 2-3, nombrados a partir de ahí**.

### 5. SQLi por concatenación

```ts
db.exec(`SELECT * FROM users WHERE email = '${userInput}'`); // ❌ NUNCA
```

**Siempre prepared statements con `?` o `$name`.** SQLite te lo permite porque es solo una librería, pero el cliente eres tú.

### 6. Conexiones desde múltiples threads

`DatabaseSync` no es thread-safe. Si usas workers (`worker_threads`), cada worker abre su propia conexión. SQLite serializa writes a nivel de archivo, lo cual sigue funcionando, pero compartir el objeto `db` entre threads no.

## Comparación rápida

| Librería          | Sync/Async | Stdlib | Madurez   | Notas                          |
|-------------------|------------|--------|-----------|--------------------------------|
| `node:sqlite`     | Sync       | ✅     | Reciente  | Cero deps, recomendado moving forward |
| `better-sqlite3`  | Sync       | ❌     | Muy alta  | Battle-tested, mismo API style |
| `sqlite3`         | Async      | ❌     | Alta      | Más viejo, callback-style hasta hace poco |
| `kysely` (+ dialect) | Sync     | ❌     | Alta      | Type-safe query builder        |
| `drizzle-orm`     | Sync       | ❌     | Alta      | ORM tipado, con migraciones    |

Para apps pequeñas y proyectos de aprendizaje: **`node:sqlite`**. Para sistemas grandes con muchos queries complejos: **kysely** o **drizzle**.

## Ejercicio

1. **Arranca el server con persistencia real**: cambia `DATABASE_PATH=./data.db` en `.env`, arranca `npm run dev`, crea un usuario por curl. Mata el proceso. Vuelve a arrancar. Verifica que el usuario sigue ahí con `curl http://localhost:3000/users/{id}` (después de implementar `GET /users/:id`, ejercicio del capítulo 07).

2. **Inspecciona la DB**: instala `sqlite3` (el CLI, no la lib) si no lo tienes. Ejecuta `sqlite3 data.db 'SELECT * FROM users;'`. Mira las filas crudas. Confirma que `email` está en minúsculas (el schema lo normalizaba en parse).

3. **Añade `created_at`**: actualiza la tabla con una columna nueva. Decide cómo manejar la migración. ¿Modificas el `CREATE TABLE IF NOT EXISTS` y eso es todo? ¿Qué pasa con bases de datos antiguas? Implementa un patrón con `PRAGMA user_version`.

4. **Contract tests**: extrae los tests de `InMemoryUserRepository` a una función `runUserRepositoryContractTests(makeRepo: () => UserRepository)`. Llámala desde **dos** archivos de test, uno para in-memory, otro para SQLite. Confirma que los mismos tests pasan contra ambas implementaciones.

5. **Reto — transacciones**: implementa un método `transferOwnership(fromEmail, toEmail)` en `UserRepository` que mueva atómicamente un campo. Implementa el helper `tx()`. Prueba que si el segundo update falla, el primero hace rollback.

6. **Reto — un repo "lazy"**: implementa una versión que **no** prepare los statements en el factory, sino lazy (la primera vez que se usan). ¿Qué pros/contras tiene? Pista: si la DB no está lista cuando se llama al factory, el lazy no falla; el eager sí.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 30 — *Be Liberal in What You Accept and Strict in What You Produce*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/loose-accept-strict-produce.md)** — la fila cruda de SQLite es "liberal" (cualquier shape); el parse por `UserSchema` la convierte en "stricta" antes de salir del repo. Postel applied to DB rows.
- **[Item 46 — *Use `unknown` Instead of `any` for Values with an Unknown Type*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-any/never-unknown.md)** — `findStmt.get()` devuelve `unknown`. No mientas con `as User`; pásalo por el schema.
- **[Item 74 — *Know How to Reconstruct Types at Runtime*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/runtime-types.md)** — `UserSchema.parse(row)` es exactamente este principio. El borde DB no es distinto al borde HTTP.
- **[Item 76 — *Create an Accurate Model of Your Environment*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/model-env.md)** — el patrón `env.DATABASE_PATH` validado en `env.ts` se extiende ahora al schema de DB.

---

**Anterior:** [07 — Servicios y repositorios](./07-servicios-y-repositorios.md)
**Siguiente:** [09 — Un frontend para el curso](./09-frontend-curso.md)
