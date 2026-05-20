# 04 — Result type

## El problema

JavaScript (y por tanto TypeScript) hereda el modelo de **excepciones** para errores:

```ts
function divide(a: number, b: number): number {
  if (b === 0) throw new Error('div by zero');
  return a / b;
}

try {
  const r = divide(10, 0);
} catch (e) {
  // ¿qué es e?
}
```

Hay tres problemas serios con esto en TS:

### Problema 1 — el tipo de `catch` es `unknown`

```ts
try {
  doSomething();
} catch (e) {
  // e: unknown (con strict)
  console.log(e.message); // ❌ Object is of type 'unknown'
}
```

En Java, `catch (FooException e)` te da un tipo concreto. En TS, `catch` siempre te da `unknown` (antes era `any`, peor). Para usar `e` tienes que **narrow** con `e instanceof Error`, lo cual rompe la fluidez.

### Problema 2 — la firma no dice qué errores lanza

```ts
function loadUser(id: string): User { /* lanza NotFound, DBError, ... */ }
```

El tipo de retorno dice `User`. La firma **miente**: en realidad puede no devolver nada (lanzar). No hay `throws` en TS (a diferencia de Java's checked exceptions). El llamador no sabe qué se le viene encima sin leer la implementación.

### Problema 3 — el flujo se rompe

Las excepciones son un **goto disfrazado**. Saltan capas de stack sin que el código intermedio lo sepa. Para errores **esperados** (validación falla, usuario no existe), esto es exagerado y oculta el flujo real.

## La solución: tipo `Result`

```ts
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Es una **discriminated union**: un tipo que es A o B, pero **siempre** con un campo discriminante (`ok`) que te dice cuál.

Lo tenemos en `src/lib/result.ts`:

```ts
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const tryCatch = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
```

Cuatro cosas que merecen análisis:

### 1. La unión discriminada

```ts
{ ok: true; value: T } | { ok: false; error: E }
```

Estos dos objetos **comparten** la propiedad `ok` pero con valores diferentes (`true` vs `false`). Cuando TS ve un `if (r.ok)`, **narrowea** el tipo:

```ts
function handle(r: Result<number>) {
  if (r.ok) {
    r.value;  // ✅ number
    r.error;  // ❌ Property 'error' does not exist
  } else {
    r.error;  // ✅ Error
    r.value;  // ❌
  }
}
```

Esto es **narrowing por discriminante**. El campo `ok` no solo guarda info — es la **etiqueta** que TS usa para decidir qué rama del union estás.

> 💡 **Analogía Go**: el patrón `value, err := foo()`. Te obliga a comprobar `err != nil` antes de usar `value`. TS llega al mismo sitio con un objeto en lugar de una tupla, pero el contrato es idéntico: **no puedes acceder al valor sin comprobar antes**.
>
> 💡 **Analogía Rust**: literalmente `Result<T, E>`. La idea está copiada de ahí.
>
> 💡 **Analogía Java**: como `Either<L, R>` en libs como Vavr. No es nativo.

### 2. `never` en los helpers

```ts
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

¿Por qué `Result<T, never>` y no `Result<T, Error>`?

`never` es el tipo "bottom": un valor que **no puede existir**. Decir `Result<T, never>` significa: este `Result` **nunca** puede ser la rama de error.

¿Para qué? Porque permite que TS combine bien con el tipo de retorno declarado:

```ts
function findUser(id: string): Result<User, NotFoundError> {
  if (!id) return err(new NotFoundError()); // Result<never, NotFoundError>
  return ok(loadUser(id));                   // Result<User, never>
}
```

Ambos retornos son **subtipos** de `Result<User, NotFoundError>` porque `never` es subtipo de cualquier tipo. Si `ok` devolviera `Result<T, Error>`, no encajaría con un retorno declarado como `Result<User, NotFoundError>`.

> 💡 **Mental model**: `never` es a los tipos lo que el conjunto vacío es a los conjuntos. Cabe en cualquier sitio porque no aporta valores nuevos.

### 3. `tryCatch` como adaptador

```ts
export const tryCatch = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
```

Convierte una función que puede lanzar en una que devuelve `Result`. Útil para envolver código de terceros (librerías que lanzan) sin contaminar tu código con try/catch.

Uso:

```ts
const r = await tryCatch(() => fetch('https://api.example.com/users').then(res => res.json()));
if (!r.ok) {
  console.error(r.error);
  return;
}
console.log(r.value);
```

Nota la guarda `e instanceof Error ? e : new Error(String(e))`. JS permite **lanzar cualquier cosa** (`throw 'string'`, `throw 42`), y aunque casi nadie lo hace, el catch debe protegerse. Si no, `r.error` no sería un `Error`.

### 4. Generics con default

```ts
type Result<T, E = Error> = ...
```

El `E = Error` es un **default generic parameter**. Te permite escribir `Result<User>` y que `E` sea `Error` automáticamente. Cuando el error es genérico, ahorra ruido. Cuando es específico, escribes `Result<User, NotFoundError>`.

> 💡 **Analogía Java**: como `Map<K, V>` donde `V` tuviera un default. Java no lo permite; TS sí.

## Patrón de uso completo

```ts
import { ok, err, type Result } from './lib/result.ts';

type DBError = { kind: 'db'; cause: unknown };
type NotFound = { kind: 'not_found'; id: string };
type UserError = DBError | NotFound;

async function findUser(id: string): Promise<Result<User, UserError>> {
  try {
    const user = await db.users.find(id);
    if (!user) return err({ kind: 'not_found', id });
    return ok(user);
  } catch (cause) {
    return err({ kind: 'db', cause });
  }
}

// Uso:
const r = await findUser('123');
if (!r.ok) {
  switch (r.error.kind) {
    case 'not_found':
      return c.json({ message: `User ${r.error.id} not found` }, 404);
    case 'db':
      return c.json({ message: 'Internal error' }, 500);
  }
}
// aquí r.value es User
```

Dos cosas a notar:

- `UserError` es **también** una discriminated union (con campo `kind`). TS narrowea el `switch` correctamente y avisa si te dejas un caso (con `noFallthroughCasesInSwitch`).
- El handler distingue errores **explícitamente**. Sin try/catch capturando "lo que sea".

## ¿Cuándo `Result` y cuándo `throw`?

Regla práctica:

- **`Result`** para errores **esperados** parte del dominio: validación, recurso no encontrado, conflicto, fallo de red previsible. El llamador debe decidir qué hacer.
- **`throw`** para **bugs** e invariantes violadas: `divide by zero` cuando ya validaste, un `switch` exhaustivo donde llega un valor imposible. Estos errores no deberían ocurrir; si ocurren, queremos un stack trace y crashear.

```ts
function divide(a: number, b: number): Result<number, 'div_by_zero'> {
  if (b === 0) return err('div_by_zero');
  return ok(a / b);
}

function assertNever(x: never): never {
  throw new Error(`Unexpected: ${x}`);
}
```

Que no haya `Result` para todo. Sería ceremonia inútil.

## Alternativa: librerías

Hay librerías que añaden combinators (`.map`, `.flatMap`, `.unwrapOr`) al Result:

- **[neverthrow](https://github.com/supermacro/neverthrow)** — minimalista, popular en TS.
- **[effect](https://effect.website/)** — todo un ecosistema funcional para TS. Potente, pero curva fuerte.
- **[fp-ts](https://gcanti.github.io/fp-ts/)** — funcional purista, más académica.

Nuestro tipo `Result` casero es **suficiente para aprender**. Para producción seria, considera neverthrow o effect.

## Trampas comunes

1. **Olvidar `await`** con `tryCatch`. Devuelve una `Promise<Result>`, no un `Result`. Si haces `if (!tryCatch(...).ok)`, estás comprobando si la promesa (un objeto, truthy) tiene `.ok`. Spoiler: no tiene.

2. **Hacer `as` en lugar de narrow**:
   ```ts
   const value = (r as { ok: true; value: number }).value; // ❌
   ```
   Te saltas el chequeo. Usa `if (r.ok)`.

3. **Re-lanzar errores que ya están en Result**:
   ```ts
   const r = await foo();
   if (!r.ok) throw r.error; // 🤔
   ```
   Si vas a relanzar, quizá la API debería ser `throw` directo. Mezcla los dos modelos sin querer.

4. **Tipar el error como `string` por pereza**:
   ```ts
   Result<User, string>  // ❌ pierdes structured error data
   ```
   Usa un objeto con `kind` discriminante. Tu yo del futuro te lo agradece cuando quieras añadir un código de error.

5. **No usar el discriminante**. Si haces:
   ```ts
   type Result<T> = { value?: T; error?: Error };
   ```
   Pierdes el narrowing. TS no puede saber, viendo `value`, si `error` está ausente. **Necesitas** el campo `ok: true | false`.

## Ejercicio

1. **Convierte el handler `/users`** en `src/index.ts` para usar `Result`. Crea una función:
   ```ts
   function parseUser(body: unknown): Result<CreateUser, ZodError> { ... }
   ```
   El handler la llama, narrowea con `if (!r.ok)`, y responde 400.

2. **Escribe una función `divide`** que devuelva `Result<number, 'div_by_zero'>`. Usa la unión `Result<number, 'div_by_zero'>` literal — observa que TS infiere bien el tipo del error como literal `'div_by_zero'`, no como `string`.

3. **Reto**: escribe un tipo `AsyncResult<T, E>` que sea simplemente `Promise<Result<T, E>>`, y un helper `pipe` que encadene dos `AsyncResult` (si el primero falla, no llama al segundo, propaga el error). No te preocupes si te cuesta — los combinators son el siguiente paso natural.

4. **Lee el código de neverthrow** (https://github.com/supermacro/neverthrow/blob/master/src/result.ts) y observa cómo implementan `map`, `mapErr`, `andThen`. Verás patrones de TS avanzados (overloads, this types). No hace falta entenderlo todo — solo familiarizarse.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 22 — *Understand Type Narrowing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/narrowing.md)** — el motor de todo el `Result`. Sin entender narrowing, el `if (r.ok)` parece magia. Con él, lo ves.
- **[Item 32 — *Avoid Including `null` or `undefined` in Type Aliases*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/null-in-type.md)** — la motivación para `Result<T, E>` en lugar de `T | null`: empujas el fallo al tipo, no lo escondes dentro.
- **[Item 34 — *Prefer Unions of Interfaces to Interfaces with Unions*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/union-of-interfaces.md)** — `Result` es exactamente este patrón: `{ ok: true; value }` ∪ `{ ok: false; error }`, no `{ ok; value?; error? }`.
- **[Item 59 — *Use `never` Types to Perform Exhaustiveness Checking*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/exhaustiveness.md)** — el `assertNever(x)` que veremos en el capítulo 07: garantía compile-time de que cubres todas las variantes de un union.

---

**Anterior:** [03 — Validación con Zod](./03-validacion-con-zod.md)
**Siguiente:** [05 — Testing con `node --test`](./05-testing-node-test.md)
