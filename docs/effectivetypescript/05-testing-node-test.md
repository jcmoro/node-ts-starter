# 05 — Testing con `node --test`

## El problema

Testear TypeScript ha sido históricamente un dolor:

- **Jest** — el estándar, pero necesita `ts-jest` o `@swc/jest`, configuración propia, no entiende ESM nativamente, conflictos con `verbatimModuleSyntax`…
- **Vitest** — mejor, pero sigue siendo una dependencia gorda con su propio mundo (vite, etc.).
- **Mocha + chai + sinon + ts-node** — tres librerías y media para hacer lo que viene en cualquier lenguaje moderno de serie.

En Java tienes JUnit. En Go tienes `go test`. En Python tienes `pytest` (o `unittest` en stdlib). En TS hasta hace poco tocaba elegir framework y peleárselo con TypeScript.

Buena noticia: **Node tiene un test runner nativo desde la 18**, estable desde la 20, y con todas las features que necesitas. Combinado con `--experimental-strip-types`, **no necesitas instalar nada** para escribir tests en TS.

## La API en 30 segundos

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('suma', () => {
  it('suma dos números', () => {
    assert.equal(2 + 2, 4);
  });
});
```

Eso es todo. Dos imports y a escribir. Los tests se ejecutan con:

```bash
node --test --experimental-strip-types 'src/**/*.test.ts'
```

Lo que ya tienes como `npm test`.

### `node:test` — el runner

Expone estas primitivas (las que vas a usar el 95% del tiempo):

| Función       | Para qué                                              |
|---------------|-------------------------------------------------------|
| `test(name, fn)`     | Define un test individual (top-level o nested) |
| `describe(name, fn)` | Agrupa tests (familiar si vienes de jest/mocha) |
| `it(name, fn)`       | Alias de `test`, idiomático dentro de `describe` |
| `before/after/beforeEach/afterEach` | Hooks de setup/teardown      |

`test`, `it` son **intercambiables**. Por convención, `it` dentro de `describe`.

### `node:assert/strict` — las aserciones

```ts
import assert from 'node:assert/strict';

assert.equal(actual, expected);        // ===
assert.notEqual(actual, expected);
assert.deepEqual(obj1, obj2);          // deep ===
assert.deepStrictEqual(obj1, obj2);    // alias del anterior con /strict
assert.ok(value);                       // truthy
assert.throws(() => { throw new Error('x') });
await assert.rejects(asyncFn);
assert.match('foo123', /^foo/);
```

**Siempre importa de `node:assert/strict`**, no de `node:assert`. La diferencia:

- `node:assert` usa `==` (igualdad laxa). Ni se te ocurra.
- `node:assert/strict` usa `===`. Lo normal en cualquier suite seria.

> 💡 **Analogía Go**: parecido a `testing` + `reflect.DeepEqual`. La diferencia es que aquí los mensajes de error vienen mejor formateados.

## Convención de archivos

En este proyecto:

- Tests **adyacentes al código** que testean: `src/lib/result.ts` → `src/lib/result.test.ts`.
- Glob: `src/**/*.test.ts`.

Hay dos escuelas:

1. **Adyacente** (la nuestra) — el test vive al lado del código. Refactor mueve los dos a la vez. Más fácil de encontrar.
2. **Carpeta separada** (`tests/` o `__tests__/`) — separa "código de producción" de "código de test" visualmente.

Para librerías y proyectos Node modernos, adyacente es más común. Para monorepos grandes con builds separados, a veces preferible la carpeta dedicada.

## Caso 1 — Testing puro: `lib/result.ts`

`src/lib/result.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, tryCatch } from './result.ts';

describe('ok', () => {
  it('wraps a value in a success Result', () => {
    const r = ok(42);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 42);
  });
});
```

Para si vienes de Java/Go esto es business as usual. Lo **interesante en TS** es la parte de tipos:

```ts
const r = ok(42);
assert.equal(r.ok, true);
if (r.ok) assert.equal(r.value, 42);
//   ^^^^^^ esto NO es decorativo
```

¿Por qué el `if (r.ok)` después del `assert.equal(r.ok, true)`?

Porque **`assert.equal` no narrowea el tipo**. TS no sabe que después de `assert.equal(r.ok, true)`, `r.ok === true`. Sigue siendo `boolean`, y por tanto `r` sigue siendo la unión completa. Si haces `r.value` directamente:

```ts
assert.equal(r.ok, true);
assert.equal(r.value, 42); // ❌ Property 'value' does not exist on type Result
```

Soluciones:

1. **El `if (r.ok)` redundante** — funciona, hace narrow, y si falla la aserción anterior nunca llega.
2. **`assert.ok(r.ok)` con cast** — `assert.ok` tampoco narrowea por defecto, así que igual de feo.
3. **`assert<r is { ok: true; value: T }>`** — más limpio pero requiere helpers.

Para tests, **opción 1**. Pragmática y clara.

> 💡 **Por qué esto es así**: Node's `assert` no usa `asserts` signatures de TS (que sí permitirían narrowing). Es legacy. Vitest sí lo hace mejor. Para este proyecto, vivimos con el `if (r.ok)` extra.

### Tests asíncronos

```ts
describe('tryCatch', () => {
  it('returns ok when the function resolves', async () => {
    const r = await tryCatch(async () => 'value');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 'value');
  });

  it('returns err when the function throws', async () => {
    const r = await tryCatch(async () => {
      throw new Error('fail');
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.message, 'fail');
  });
});
```

El callback de `it` puede ser `async`. Si la promesa rechaza, el test falla. Misma idea que `pytest` async o `JUnit` con `CompletableFuture`.

## Caso 2 — Testing HTTP con Hono

Aquí pasa algo que merece **un cambio en el código**: separar la **definición del app** del **arranque del servidor**.

### Por qué refactorizar

`src/index.ts` antes:

```ts
const app = new Hono();
app.get('/health', ...);
serve({ fetch: app.fetch, port: env.PORT }, ...); // ← side effect: levanta el server
```

Si en un test haces `import './index.ts'`, **levantas un servidor real** en el puerto. Eso es caro, hace los tests dependientes del entorno (puerto libre, env válido), y rompe ejecución en paralelo.

Patrón idiomático (lo verás en cualquier proyecto Hono/Express/Fastify maduro):

- **`src/app.ts`** — define la app, exporta el objeto. **Sin side effects.**
- **`src/index.ts`** — importa la app y arranca el server. **Es el único con side effects.**

### El refactor

`src/app.ts` (nuevo):

```ts
import { Hono } from 'hono';
import { z } from 'zod';

export const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

const CreateUser = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

app.post('/users', async (c) => {
  const body = await c.req.json();
  const parsed = CreateUser.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }
  return c.json({ id: crypto.randomUUID(), ...parsed.data }, 201);
});
```

`src/index.ts` (queda mínimo):

```ts
import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { env } from './env.ts';

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`listening on http://localhost:${port}`);
});
```

> 💡 **Lección general**: separar **declaración** de **ejecución** hace todo más testeable. Vale para HTTP servers, workers, jobs, etc. Patrón conocido como "**composition root**".

### `app.request` — testing sin puerto

Hono expone `app.request(path, init?)` que devuelve una `Response` **sin necesidad de servidor**. Procesa la request a través de los handlers en memoria. Más rápido y más simple.

`src/app.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './app.ts';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health');
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string };
    assert.equal(body.status, 'ok');
  });
});

describe('POST /users', () => {
  it('creates a user with valid body', async () => {
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jose@example.com', name: 'Jose' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { id: string; email: string; name: string };
    assert.equal(body.email, 'jose@example.com');
  });

  it('returns 400 with invalid email', async () => {
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', name: 'X' }),
    });
    assert.equal(res.status, 400);
  });
});
```

Observaciones:

- `app.request` devuelve una `Response` (el objeto estándar de Fetch API). `res.json()`, `res.status`, `res.headers` — todo lo que esperas.
- El cast `as { status: string }` es necesario porque `res.json()` devuelve `Promise<unknown>` (Zod-style: el JSON entrante no se autotipa). Para tests pequeños es aceptable; en producción **valida con Zod**.
- En `Content-Type`: si te lo dejas, Hono no parsea el body como JSON y `c.req.json()` falla.

## Scripts útiles

En `package.json`:

```json
{
  "scripts": {
    "test": "node --test --experimental-strip-types 'src/**/*.test.ts'",
    "test:watch": "node --test --watch --experimental-strip-types 'src/**/*.test.ts'",
    "test:coverage": "node --test --experimental-test-coverage --experimental-strip-types 'src/**/*.test.ts'"
  }
}
```

### `--watch`

Re-ejecuta tests al cambiar archivos. Útil para TDD. Equivalente a `jest --watch` o `vitest`.

### `--experimental-test-coverage`

Cobertura nativa, sin `nyc`/`c8`. Imprime una tabla al final con líneas/branches/funciones cubiertas:

```
# coverage
# --------
# file                | line % | branch % | funcs %
# src/lib/result.ts   |  95.00 |   90.00  | 100.00
```

Aún experimental, pero suficiente para tener un número de referencia.

### Reporters

```bash
node --test --test-reporter=spec ...  # mocha-style legible
node --test --test-reporter=dot ...   # un punto por test
node --test --test-reporter=tap ...   # TAP (default)
```

Si tu CI espera JUnit XML:

```bash
node --test --test-reporter=junit --test-reporter-destination=junit.xml ...
```

## Comparación rápida con otros runners

| Aspecto          | `node --test` | Vitest         | Jest          |
|------------------|---------------|----------------|---------------|
| Setup TS         | Nada (strip-types) | `vitest` y ya | `ts-jest` + config |
| ESM nativo       | ✅            | ✅             | ⚠️ con config |
| Watch            | ✅            | ✅             | ✅            |
| Coverage         | ✅ experimental | ✅            | ✅            |
| Mocks            | `mock` API nativa básica | ✅ buenísima | ✅ enorme    |
| `expect(x).toEqual` | ❌ usa `assert` | ✅          | ✅            |
| Snapshots        | ✅ desde 22.3  | ✅             | ✅            |
| Velocidad        | Muy rápida    | Muy rápida     | Lenta         |
| Ecosistema       | Pequeño       | Grande         | Inmenso       |

**Cuándo subir a Vitest**: cuando necesites mocking complejo (módulos enteros), snapshots avanzados, o un ecosistema de plugins (testing-library, etc.).

**Para backend pequeño/medio**: `node --test` sobra.

## Type-level testing (mención breve)

A veces no quieres testear que el código **se ejecuta** correctamente, sino que **tipa** correctamente. Patrón clásico:

```ts
type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;

type _ = Expect<Equal<ReturnType<typeof ok<number>>, Result<number, never>>>;
```

Si los tipos no encajan, `tsc --noEmit` falla. Lo dejamos para más adelante porque hay matices (el truco del `(<T>() => ...)` es famoso pero no obvio).

## Trampas comunes

1. **Olvidar `await` en async tests**. El test pasa pero no testea nada. Si la promesa rechaza después, el test runner se queja en otro test ("unhandled rejection").
2. **Usar `node:assert` en vez de `node:assert/strict`**. Igualdad laxa = bugs sutiles.
3. **Importar el `index.ts` en tests**. Levanta el server. Por eso refactorizamos a `app.ts`.
4. **No comprobar discriminantes antes de acceder al valor**. El narrowing manual con `if (r.ok)` es obligatorio.
5. **`assert.deepEqual` con objetos que tienen funciones o `undefined`**. Las comparaciones de funciones son por referencia. `undefined` y propiedades ausentes son tratadas diferente con `exactOptionalPropertyTypes` en el código real — pero `deepEqual` los considera iguales.
6. **`Content-Type` ausente en POST**. `c.req.json()` falla silenciosamente.

## Ejercicio

1. **Lee y ejecuta** los tests del repo:
   ```bash
   npm test
   ```
   Confirma que pasan los de `result.test.ts` y `app.test.ts`.

2. **Rompe un test a propósito** — cambia el `assert.equal(res.status, 201)` por `200`. Observa el output del runner. ¿Cómo te indica qué línea falla?

3. **Añade un test** que verifique que `POST /users` con un body **vacío** (`{}`) devuelve 400 y que el `error.tree` menciona tanto `email` como `name`. Pista: `assert.match` con regex sobre `JSON.stringify(body.error)`.

4. **Watch mode**: lanza `npm run test:watch` y edita `src/lib/result.ts`. Confirma que los tests se re-ejecutan solos.

5. **Coverage**: lanza `npm run test:coverage` y mira el output. ¿Qué archivos del proyecto no tienen cobertura? ¿Cuáles tiene sentido cubrir y cuáles no?

6. **Reto** — escribe un test del tipo `Result<T, E>`: usa el truco `Expect<Equal<...>>` para verificar que `ok(42)` tiene tipo `Result<number, never>`. Si no compila, fallo de tipo. Si compila, ok. ¿Por qué este test no necesita `it()` ni `assert`?

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 55 — *Write Tests for Your Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/test-your-types.md)** — el capítulo paralelo del libro. El truco `Expect<Equal<X, Y>>` que mencionamos al final está explicado aquí en detalle. Es el siguiente paso natural cuando los tipos del proyecto se complican.
- **[Item 77 — *Understand the Relationship Between Type Checking and Unit Testing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/types-or-tests.md)** — qué cubre el tipo, qué cubre el test, y dónde dejan huecos cada uno. Esencial para no duplicar esfuerzo ni dejar bugs entre los dos.

---

**Anterior:** [04 — Result type](./04-result-type.md)
**Siguiente:** [06 — Branded types](./06-branded-types.md)
