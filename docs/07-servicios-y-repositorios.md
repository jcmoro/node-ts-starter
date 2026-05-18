# 07 — Servicios y repositorios

## El problema

Hasta ahora todo vive en el handler:

```ts
app.post('/users', async (c) => {
  const body = await c.req.json();
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: ... }, 400);

  const user = { id: newUserId(), ...parsed.data };
  return c.json(user, 201);
});
```

Tres cosas mezcladas en 8 líneas:

1. **Transporte** — leer body, devolver status.
2. **Validación** — schema de Zod.
3. **Lógica de dominio** — generar ID, "crear" el user.

Eso no escala. En cuanto haya **persistencia** ("comprueba si el email ya existe"), **reglas de negocio** ("admin no puede borrarse a sí mismo"), o **multi-transport** (mismo create user desde HTTP y desde un consumer de Kafka), necesitas **separar capas**.

## El layering clásico

```
┌─────────────────────────────────┐
│ HTTP handlers (app.ts)          │  ← transporte: parsea request, devuelve response
├─────────────────────────────────┤
│ Services (services/)            │  ← lógica de aplicación, orquestación
├─────────────────────────────────┤
│ Repositories (repositories/)    │  ← acceso a datos, persistencia
├─────────────────────────────────┤
│ Domain (domain/)                │  ← tipos, schemas, value objects
└─────────────────────────────────┘
```

Reglas básicas:

- **Cada capa sólo conoce las de debajo**. El service no sabe nada de HTTP. El repositorio no sabe nada de servicios.
- **El dominio no depende de nada**. Solo tipos puros.
- **Los errores son tipados**, no excepciones random.

Si vienes de Spring (Java) o Gin (Go) esto es **familiar**. La diferencia es **cuánta ceremonia** necesitas para conseguirlo. Spoiler: en TS, casi ninguna.

## La capa de repositorio

### Interface

`src/repositories/user-repository.ts`:

```ts
import type { Email, User } from '../domain/user.ts';

export interface UserRepository {
  findByEmail(email: Email): Promise<User | null>;
  save(user: User): Promise<void>;
}
```

**Esto es el contrato**. Lo que cualquier implementación debe ofrecer. Quien use `UserRepository` (los servicios) no sabrá si es Postgres, Mongo, un Map en memoria o un mock.

> 💡 **Nota TS**: `interface` y `type` son casi equivalentes para esto. Diferencias mínimas:
> - `interface` permite "declaration merging" (extender desde otro archivo). Útil para librerías, peligroso en código de aplicación.
> - `type` permite uniones, intersecciones complejas, mapped types.
>
> Convención común: **`interface` para contratos de servicios/repos**, **`type` para datos y uniones**. Es estética; ambas funcionan.

### Implementación in-memory (factory)

```ts
import type { Email, User } from '../domain/user.ts';
import type { UserRepository } from './user-repository.ts'; // o desde el mismo archivo

export function createInMemoryUserRepository(): UserRepository {
  const users = new Map<Email, User>();

  return {
    async findByEmail(email) {
      return users.get(email) ?? null;
    },
    async save(user) {
      users.set(user.email, user);
    },
  };
}
```

Tres cosas a observar:

1. **Factory function, no class.** En TS moderno se usa más una función que devuelve un objeto que una clase. El estado vive en el **closure** (`const users = new Map(...)`). Esto:
   - No tiene `this`, así que no hay sorpresas de binding.
   - Es más fácil de componer.
   - Sigue siendo idiomático JS/TS.

2. **No hay `implements UserRepository`.** TypeScript es estructural — si el objeto retornado tiene los métodos correctos, **es** un `UserRepository`. El `: UserRepository` en el tipo de retorno actúa como check (TS valida que el objeto cumple el contrato).

3. **Si prefieres clases, también vale**:
   ```ts
   export class InMemoryUserRepository implements UserRepository {
     private users = new Map<Email, User>();
     async findByEmail(email: Email) { return this.users.get(email) ?? null; }
     async save(user: User) { this.users.set(user.email, user); }
   }
   ```
   Más verboso, más Java-vibe. Funciona igual. Para repos compartibles entre tests y producción, las factory functions son lo que verás en proyectos TS modernos.

> 💡 **Comparación Go**: idéntico al patrón `func NewInMemoryUserRepo() UserRepository { ... }` con tipo interface y struct privado. La diferencia: en TS no hay struct — solo el closure.
>
> 💡 **Comparación Java**: en lugar de `@Service @Repository` con inyección por anotaciones, aquí **inyectas tú** pasando deps a funciones. Lo veremos en "composition root".

## La capa de servicio

`src/services/user-service.ts`:

```ts
import { ok, err, type Result } from '../lib/result.ts';
import type { CreateUser, Email, User } from '../domain/user.ts';
import { newUserId } from '../domain/user.ts';
import type { UserRepository } from '../repositories/user-repository.ts';

export type UserError = { kind: 'email_already_taken'; email: Email };

export async function createUser(
  repo: UserRepository,
  payload: CreateUser
): Promise<Result<User, UserError>> {
  const existing = await repo.findByEmail(payload.email);
  if (existing) {
    return err({ kind: 'email_already_taken', email: payload.email });
  }

  const user: User = { id: newUserId(), ...payload };
  await repo.save(user);
  return ok(user);
}
```

Tres cosas:

1. **Es una función pura, no una clase.** Recibe sus dependencias como argumentos (`repo`), no las "inyecta" un framework. Esto se llama a veces "**poor man's DI**" — y para el 90% de aplicaciones es **suficiente**.

2. **Devuelve `Result<User, UserError>`.** No lanza excepciones para errores esperados. Si el email ya existe, el llamador recibe un `err({ kind: 'email_already_taken', ... })` y decide qué hacer.

3. **`UserError` es una discriminated union** (capítulo 04). Hoy solo tiene un caso; mañana, cuando añadas `UserNotFound`, `InvalidStateTransition`, etc., extiendes la unión:
   ```ts
   export type UserError =
     | { kind: 'email_already_taken'; email: Email }
     | { kind: 'not_found'; id: UserId };
   ```
   El `switch` exhaustivo en el handler te avisará si te dejas un caso (gracias a `noFallthroughCasesInSwitch` + checks de exhaustividad).

### ¿Dónde viven los errores?

Pregunta de diseño legítima. Dos opciones:

- **En el dominio** (`domain/user.ts`) — si el error es **conceptual del aggregate** (`UserNotFound`, `EmailAlreadyTaken`, "no puedes borrar al admin"). Cualquier servicio que opere con users lo reutiliza.
- **En el servicio** (`services/user-service.ts`) — si el error es **del use case** (`SignupRateLimited`, "este flujo no admite eso").

Aquí lo dejo en `user-service.ts` para empezar simple. Si crece, lo promueves al dominio.

## Composition root: `createApp(deps)`

Llega el momento de pegar las piezas. El **composition root** es el único sitio donde **se construyen** las dependencias y se inyectan. Suele ser cerca del `main`.

`src/app.ts` (refactorizado):

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { CreateUserSchema } from './domain/user.ts';
import { createUser } from './services/user-service.ts';
import type { UserRepository } from './repositories/user-repository.ts';

export type AppDeps = {
  userRepo: UserRepository;
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.post('/users', async (c) => {
    const body = await c.req.json();
    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: z.treeifyError(parsed.error) }, 400);
    }

    const result = await createUser(deps.userRepo, parsed.data);
    if (!result.ok) {
      switch (result.error.kind) {
        case 'email_already_taken':
          return c.json({ error: 'email already taken' }, 409);
      }
    }

    return c.json(result.value, 201);
  });

  return app;
}
```

Y `src/index.ts`:

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { env } from './env.ts';
import { createInMemoryUserRepository } from './repositories/user-repository.ts';

const userRepo = createInMemoryUserRepository();
const app = createApp({ userRepo });

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`listening on http://localhost:${port}`);
});
```

**Esto es todo el "DI" que necesitas** para casi todo lo que vas a escribir. No Spring, no NestJS modules, no inversify. Una función `createApp` que recibe sus deps. Lo más sencillo posible.

> 💡 **Cuándo subir a un framework de DI** (Awilix, Inversify, NestJS):
> - Cuando tengas >30 dependencias y "pasar argumentos" se vuelve ceremonia.
> - Cuando necesites **scoped lifecycles** complejos (request-scoped, transaction-scoped).
> - Cuando trabajes con equipos grandes y quieras estructura "obvia".
>
> Para todo lo demás: **una factory function con un objeto de deps**.

## Patrón de uso: exhaustividad en el switch

Mira con detalle el handler:

```ts
if (!result.ok) {
  switch (result.error.kind) {
    case 'email_already_taken':
      return c.json({ error: 'email already taken' }, 409);
  }
}
```

Cuando `UserError` tenga más variantes, este `switch` debe cubrirlas todas. Para **forzar** exhaustividad:

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled UserError: ${JSON.stringify(x)}`);
}

// ...
switch (result.error.kind) {
  case 'email_already_taken':
    return c.json({ error: 'email already taken' }, 409);
  default:
    return assertNever(result.error);
}
```

Si añades `kind: 'not_found'` al union y se te olvida el case, TS te chilla porque `result.error` ya no es `never` en el `default`. Es el patrón **exhaustive switch** y vale oro.

> 💡 **Comparación**: Rust hace esto nativamente con `match`. Java 21+ con `switch` sobre sealed types. TS lo hace **a mano** pero gratis (el `assertNever` cabe en 2 líneas).

## Testing por capa

Cada capa se testea **independientemente**. Tres niveles:

### 1. Test del repositorio

`src/repositories/user-repository.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryUserRepository } from './user-repository.ts';

describe('InMemoryUserRepository', () => {
  it('returns null when no user exists', async () => {
    const repo = createInMemoryUserRepository();
    const user = await repo.findByEmail('jose@example.com' as Email);
    assert.equal(user, null);
  });

  it('persists a user via save and retrieves it via findByEmail', async () => {
    const repo = createInMemoryUserRepository();
    const user = { /* ... */ };
    await repo.save(user);
    assert.equal(await repo.findByEmail(user.email), user);
  });
});
```

### 2. Test del servicio (con repo en memoria como fake)

`src/services/user-service.test.ts`:

```ts
import { createInMemoryUserRepository } from '../repositories/user-repository.ts';
import { createUser } from './user-service.ts';

describe('createUser', () => {
  it('creates a new user', async () => {
    const repo = createInMemoryUserRepository();
    const result = await createUser(repo, payload);
    assert.equal(result.ok, true);
  });

  it('fails when email already exists', async () => {
    const repo = createInMemoryUserRepository();
    await createUser(repo, payload);
    const result = await createUser(repo, payload);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'email_already_taken');
  });
});
```

**Observación importante**: no hace falta un **mock**. Usamos el **repo real in-memory** como fake. Esto se llama "**fake over mock**":

- **Mocks** — objetos que reciben llamadas pre-configuradas (`.expects('save').returns(...)`). Frágiles, se rompen con cualquier refactor.
- **Fakes** — implementaciones reales pero simples (en memoria). Estables, te dicen si el contrato cambia.

Si tu repo expone `findByEmail` y mañana añades `findById`, el fake no necesita cambios. Un mock lo tendrías que recompletar.

### 3. Test del handler (con `createApp({ userRepo: fake })`)

`src/app.test.ts`:

```ts
import { createApp } from './app.ts';
import { createInMemoryUserRepository } from './repositories/user-repository.ts';

describe('POST /users', () => {
  it('creates a user', async () => {
    const app = createApp({ userRepo: createInMemoryUserRepository() });
    const res = await app.request('/users', { /* ... */ });
    assert.equal(res.status, 201);
  });

  it('returns 409 when email is already taken', async () => {
    const userRepo = createInMemoryUserRepository();
    const app = createApp({ userRepo });
    await app.request('/users', { /* primer create */ });
    const res = await app.request('/users', { /* mismo email */ });
    assert.equal(res.status, 409);
  });
});
```

**Cada test crea su propia app con su propio repo.** Aislamiento total entre tests, sin estado compartido. Costaba contortionismos en Java/Spring; aquí es trivial porque `createApp` es solo una función.

## Comparación con frameworks pesados

| Concepto                       | TS (este enfoque)                 | Spring (Java)            | NestJS (TS framework)      |
|--------------------------------|-----------------------------------|--------------------------|----------------------------|
| Declarar un servicio           | `function` exportada              | `@Service`               | `@Injectable()`            |
| Declarar dependencias          | Parámetros de la función          | `@Autowired` / constructor | Constructor + decorators |
| Composición                    | `createApp({ deps })`             | El container de Spring   | `@Module({ providers })`   |
| Sustituir en tests             | Pasas otra implementación         | `@MockBean`, mocks       | `Test.createTestingModule` |
| Boilerplate                    | ~0                                | Mucho, pero consistente  | Mucho, decoradores         |
| Curva                          | Plana                             | Empinada                 | Empinada                   |

Para proyectos pequeños/medianos en TS, **el enfoque funcional aquí es más simple y más testeable**. La complejidad de Spring/NestJS solo se justifica con tamaño y heterogeneidad (módulos federados, microservicios, etc.).

## Trampas comunes

### 1. Estado compartido entre tests

```ts
const userRepo = createInMemoryUserRepository(); // ❌ fuera de tests
describe(...) // todos los tests comparten el mismo repo
```

Crea el repo **dentro** de cada test (o en `beforeEach`). Si dos tests escriben al mismo Map, los resultados son no-deterministas.

### 2. Capas filtrando hacia arriba

```ts
// En el service
import type { Context } from 'hono'; // ❌
function createUser(c: Context, payload) { ... }
```

El service **no debe conocer HTTP**. Si lo hace, ya no es service — es un handler con otro nombre. Mantén el `Context` de Hono solo en `app.ts`.

### 3. Excepciones cruzando capas

```ts
// En el repo
async findByEmail(email) {
  const r = await db.query(...);
  if (!r) throw new NotFoundError(); // ❌
  return r;
}
```

Si el repo lanza, el service tiene que `try/catch` (o se le escapa la excepción al handler). Mejor: **el repo devuelve `Result` o `null`**, el service traduce a `Result<T, ServiceError>` semánticamente.

Para errores **infraestructurales** (DB caída, timeout) **sí tiene sentido lanzar** — son bugs, no flujo de negocio. El handler las capturará en un middleware genérico.

### 4. Dependencias entre repos/servicios

```ts
export type AppDeps = {
  userRepo: UserRepository;
  emailService: EmailService;
  userService: UserService; // ← OJO si UserService depende a su vez de UserRepository
};
```

Cuando `createApp` empiece a recibir 8 deps, considera factorizar:

```ts
function buildServices(repos) {
  return {
    userService: (payload) => createUser(repos.userRepo, payload),
    // ...
  };
}
const repos = buildRepos();
const services = buildServices(repos);
const app = createApp({ ...repos, ...services });
```

Más estructurado, sigue siendo plain functions. Llegará el día que esto cante a "queremos un container de verdad" — y entonces miras Awilix.

### 5. Esconder la dependencia con singletons

```ts
// ❌
const userRepo = createInMemoryUserRepository();
export function createUser(payload) { ... } // usa userRepo desde el módulo
```

Tentador y mata la testabilidad. **Pasa las deps siempre por argumento**, aunque parezca redundante. Cuando quieras un mock en tests te lo agradecerás.

## Ejercicio

1. **Añade `getUserById(id: UserId)`** al `UserRepository` y al `UserService`. El service debe devolver `Result<User, UserError>` donde `UserError` ahora es una unión de `email_already_taken | not_found`. Aplica el `assertNever` exhaustivo en el handler de `GET /users/:id`.

2. **Implementa un repo "que falla siempre"** (para tests):
   ```ts
   function createFailingUserRepository(): UserRepository {
     return {
       async findByEmail() { throw new Error('db down'); },
       async save() { throw new Error('db down'); },
     };
   }
   ```
   Usa este repo en un test para verificar que el handler propaga un 500 (necesitarás un middleware de error handling en Hono — investígalo).

3. **Reto — Repository genérico**: define un tipo `Repository<T, K>` que tenga `findById(id: K): Promise<T | null>` y `save(value: T): Promise<void>`. Convierte `UserRepository` en `Repository<User, UserId>`. ¿Qué ventajas y qué desventajas tiene generalizar?

4. **Reto — Transactional consistency**: el flujo "crear user → enviar bienvenida" debería ser atómico. Diseña cómo lo modelarías. Pista: dos opciones — outbox pattern, o un service que coordine y un retry. No hace falta implementarlo; piénsalo en texto.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 13 — *Know the Differences Between `type` and `interface`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/type-vs-interface.md)** — la justificación de usar `interface` para `UserRepository` (contrato extensible) y `type` para `UserError` (union discriminada).
- **[Item 29 — *Prefer Types That Always Represent Valid States*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/valid-states.md)** — el principio detrás del `Result<User, UserError>`: imposible representar "tengo el user Y el error". El tipo lo impide.
- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — `email_already_taken`, no `error_409`. El nombre del error es del dominio, no del transporte.
- **[Item 67 — *Export All Types That Appear in Public APIs*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/export-your-types.md)** — `UserRepository`, `UserError`, `AppDeps` son tipos que consume todo el mundo. Si los escondes, los tests no pueden tiparlos.

---

**Anterior:** [06 — Branded types](./06-branded-types.md)
**Siguiente:** [08 — Persistencia con `node:sqlite`](./08-persistencia-sqlite.md)
