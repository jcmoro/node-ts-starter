# 26 — Async, `Promise<T>` y `Awaited<T>`

## El problema

Async en JS evolucionó en tres olas: callbacks → Promises → async/await. TS añade tipos a cada capa, pero la inferencia tiene matices que no son obvios:

- ¿Qué tipo tiene `await fetch(url)`? ¿Y `await Promise.resolve(Promise.resolve(42))`? (Spoiler: aplana.)
- `Promise.all([a, b])` devuelve una **tuple**, no un array — la diferencia importa para destructuring tipado.
- En `try { ... } catch (e) { ... }`, **`e` es `unknown`** con `useUnknownInCatchVariables` (activo en este repo).
- `async function foo()` que retorna `42` tiene tipo `Promise<number>`. ¿Y si retornas `Promise<number>` desde un async function? También `Promise<number>` — los Promises se aplanan automáticamente.

Este doc cubre las reglas de inferencia que rigen async en TS, el utility type `Awaited<T>`, las cuatro variantes de `Promise.all/allSettled/race/any`, cancelación con `AbortSignal`, y top-level await en ESM.

## `Promise<T>` — el tipo estructural

`Promise<T>` es una interfaz estructural. Cualquier objeto con `.then(onFulfilled, onRejected)` compatible es asignable — incluso si no es un `Promise` real. Esto se llama **"thenable"**:

```ts
type FakePromise = {
  then(onFulfilled: (v: number) => void, onRejected?: (e: unknown) => void): void;
};

const thenable: FakePromise = { /* ... */ };
const real: Promise<number> = thenable;   // ⚠️ TS lo acepta si la firma encaja
```

En la práctica, **no construyas thenables** — usa Promises reales. Pero el sistema es estructural: librerías antiguas (jQuery Deferred, AngularJS `$q`) son thenables y JS los desempaqueta correctamente.

### Constructores tipados

```ts
Promise.resolve(42);                // Promise<number>
Promise.resolve();                  // Promise<void>
Promise.reject(new Error('x'));     // Promise<never>

new Promise<User>((resolve, reject) => {
  resolve({ id: '1', name: 'Jose' });
});
```

`Promise.resolve()` sin argumentos da `Promise<void>`. `Promise.reject(...)` siempre `Promise<never>` (el código que continúa ya no produce ningún valor). El constructor `new Promise<T>(...)` necesita el tipo explícito porque TS no lo infiere del `resolve()` interno.

### `Promise<void>` vs `Promise<undefined>`

Sutil pero importante:

```ts
async function a(): Promise<void> { /* no return */ }
async function b(): Promise<undefined> { return undefined; }

const va: void = await a();          // ✅
const vb: undefined = await b();     // ✅

// Pero...
function takesPromise(p: Promise<undefined>) {}
takesPromise(a());                   // ❌ Promise<void> no es Promise<undefined>
```

`void` es "no me importa el valor". `undefined` es "el valor es exactamente undefined". Usa `Promise<void>` para funciones que no retornan nada relevante.

## `async/await` y la inferencia

```ts
async function loadUser(id: string): Promise<User> {
  const row = await db.query`SELECT * FROM users WHERE id = ${id}`;
  return parseUser(row);
}
```

Tres puntos:

1. **`async` envuelve el retorno en `Promise<T>`** automáticamente. Si tu function body devuelve `User`, el tipo declarado debe ser `Promise<User>`.
2. **`await` desempaqueta un Promise**. `await promiseOfUser` tiene tipo `User`.
3. **`await` sobre un valor no-Promise** lo deja pasar:
   ```ts
   const x = await 42;                // type: number
   const y = await null;              // type: null
   ```

### `Promise<Promise<T>>` se aplana

```ts
async function foo(): Promise<number> {
  return Promise.resolve(42);        // Promise<Promise<number>> esperado, pero...
}

// ✅ Funciona — async functions aplanan Promises devueltos.
// El tipo declarado Promise<number> es correcto.
```

Y al hacer await:

```ts
const p = Promise.resolve(Promise.resolve(42));
// type: Promise<number> — NO Promise<Promise<number>>

const v = await p;                   // type: number
```

Esto es **`Awaited<T>` en acción**.

## `Awaited<T>` — el utility type recursivo

Definido en `lib.es5.d.ts`:

```ts
type Awaited<T> =
  T extends null | undefined ? T :
  T extends object & { then(onfulfilled: infer F, ...args: infer _): any } ?
    F extends (value: infer V, ...args: infer _) => any ?
      Awaited<V> :    // recursivo!
      never :
  T;
```

Lo que hace:

```ts
type A = Awaited<Promise<number>>;            // number
type B = Awaited<Promise<Promise<string>>>;   // string  ← recursivo
type C = Awaited<number>;                     // number  ← no-Promise pasa
type D = Awaited<Promise<Promise<Promise<User>>>>;  // User
```

Cuándo lo usas explícitamente:

```ts
async function processAll<T>(items: T[]): Promise<Awaited<T>[]> {
  return Promise.all(items.map(async (item) => await item));
}

// O para extraer el tipo de retorno de una función async:
declare function fetchUser(id: string): Promise<User>;
type UserType = Awaited<ReturnType<typeof fetchUser>>;   // User
```

En el 95% de los casos no necesitas escribir `Awaited<...>` — TS lo aplica automáticamente al `await`. Aparece cuando manipulas tipos a nivel meta.

## `Promise.all`, `allSettled`, `race`, `any`

Cuatro composiciones con semánticas distintas:

### `Promise.all<T[]>` — todo o nada, tuple-typed

```ts
const [user, orders, profile] = await Promise.all([
  fetchUser(id),                     // Promise<User>
  fetchOrders(id),                   // Promise<Order[]>
  fetchProfile(id),                  // Promise<Profile>
]);
// user: User, orders: Order[], profile: Profile
```

TS infiere una **tuple type** (preserva el orden y los tipos individuales) cuando le pasas un array literal. Si uno falla, el `Promise.all` rechaza con ese error y los demás se descartan (no se cancelan — siguen ejecutándose pero su resultado se pierde).

### `Promise.allSettled<T[]>` — esperar a todos sin importar resultado

```ts
const results = await Promise.allSettled([fetchA(), fetchB(), fetchC()]);
// results: PromiseSettledResult<...>[]

for (const r of results) {
  switch (r.status) {
    case 'fulfilled':
      console.log(r.value);          // type narrowed
      break;
    case 'rejected':
      console.error(r.reason);       // type narrowed
      break;
  }
}
```

`PromiseSettledResult<T>` es **una discriminated union** (recuerda doc 04):

```ts
type PromiseSettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: any };
```

Útil cuando quieres ejecutar todas las operaciones y luego decidir qué hacer con cada resultado individualmente.

### `Promise.race<T>` — la primera que resuelve gana (resolve OR reject)

```ts
const fastest = await Promise.race([
  fetchPrimary(),
  fetchFallback(),
]);
// fastest: User — del primero que resuelva (incluso si es rechazado)
```

Tipo: `T1 | T2 | T3 | ...` — la unión de los posibles valores. **Race incluye los rejects**: si la primera Promise en settling es un reject, `race` rechaza con ese error.

### `Promise.any<T>` — la primera que **resuelve** exitosamente

```ts
const fastestOk = await Promise.any([
  fetchPrimary(),
  fetchFallback(),
]);
// fastestOk: User — del primero que resuelva sin rechazar
```

Diferencia con `race`: `any` ignora los rejects y espera al primer fulfilled. Si **todas** fallan, lanza `AggregateError` con todos los errores. ES2021.

### Tabla decisión

| Necesito                                          | Usa              |
|---------------------------------------------------|------------------|
| Todos los resultados, fallar al primer error      | `Promise.all`    |
| Todos los resultados, manejar fallos individualmente | `Promise.allSettled` |
| La primera respuesta (success o failure)          | `Promise.race`   |
| La primera respuesta exitosa                      | `Promise.any`    |

## Cancellation con `AbortSignal`

El patrón canónico moderno para cancelación. Web API estándar, soportado por Node 18+ en `fetch`, en `setTimeout`, en streams.

```ts
async function fetchWithTimeout<T>(url: string, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}
```

Cuando `ctrl.abort()` se llama, `fetch` rechaza inmediatamente con un `DOMException` de nombre `'AbortError'`. El `setTimeout` se cancela en `finally` para no fugar el handler.

### Encadenar cancelación

```ts
async function fetchAll<T>(urls: string[], parentSignal: AbortSignal): Promise<T[]> {
  // Re-emit el abort a un signal interno (composición simple).
  const internal = new AbortController();
  parentSignal.addEventListener('abort', () => internal.abort());

  const results = await Promise.all(
    urls.map((u) => fetch(u, { signal: internal.signal }))
  );
  return Promise.all(results.map((r) => r.json() as Promise<T>));
}
```

Si el caller aborta `parentSignal`, todos los fetches internos abortan. Patrón típico para "cancelar la operación entera si el usuario cancela el request".

`AbortSignal.timeout(ms)` (Node 17+) es el atajo:

```ts
fetch(url, { signal: AbortSignal.timeout(5000) });   // rejects after 5s
```

## Async iterators y generators

Cuando produces valores progresivamente (streams, paginación, polling), `async function*` + `for await...of` es lo idiomático:

```ts
async function* paginate<T>(fetchPage: (n: number) => Promise<T[]>): AsyncGenerator<T> {
  let page = 0;
  while (true) {
    const items = await fetchPage(page++);
    if (items.length === 0) return;
    for (const item of items) yield item;
  }
}

for await (const user of paginate(fetchUsersPage)) {
  console.log(user);
}
```

Tipos involucrados:

- **`AsyncGenerator<Y, R, N>`** — Yield type, Return type (`void` default), Next type (`undefined` default).
- **`AsyncIterable<T>`** — abstracta, solo expone `[Symbol.asyncIterator]()`.
- **`AsyncIterator<T>`** — interna, expone `.next()`, `.return()`, `.throw()`.

> 💡 **Conexión con doc 24**: `for await...of` requiere que el objeto implemente `[Symbol.asyncIterator]`. `async function*` lo implementa automáticamente — el azúcar te lo da todo gratis.

## Top-level await (ESM, Node 16+)

Desde ES2022, puedes usar `await` directamente en el top-level de un módulo:

```ts
// db.ts (ESM)
import { connect } from 'postgres';

const db = await connect(process.env.DATABASE_URL!);
//          ^^^^^ top-level await — el módulo entero "espera" a este awaited

export { db };
```

Reglas:

- Solo en módulos ES (`"type": "module"` en package.json o `.mts`/`.cts`).
- `tsconfig.json` con `"module": "NodeNext"` o `"ESNext"` y `"target": "ES2022"` o superior.
- El módulo se vuelve **async**: los importadores esperan implícitamente a que termine.

Trampas:

- Si tu top-level await es **lento**, bloquea el arranque de los importadores que dependen de este módulo.
- Detección de **circular dependencies** se complica.
- Tests: algunos runners viejos no lo soportan.

Para casos como "lazy-initialized DB", úsalo. Para inicialización compleja, prefiere una `async function init()` exportada que el caller invoque explícitamente.

## Inferencia: casos no obvios

### `async` con conditional return

```ts
async function maybeUser(found: boolean) {
  if (found) return { id: '1', name: 'Jose' };
  return null;
}
// type: Promise<{ id: string; name: string } | null>
```

El tipo de retorno se infiere como la **unión** de los return types. Sin la unión explícita, TS la deduce.

### `Promise.resolve(undefined)` vs `Promise.resolve()`

```ts
Promise.resolve();                   // Promise<void>
Promise.resolve(undefined);          // Promise<undefined>
```

Misma cuestión que `void` vs `undefined`. Sutil pero a veces te encuentras `Promise<undefined>` cuando esperabas `Promise<void>` y no compone.

### `await` en non-Promise pasa el valor

```ts
async function noop() {
  const x = await 42;                // x: number
  const y = await { id: '1' };       // y: { id: string } — async functions can await anything
  return y;
}
```

Útil para escribir funciones agnósticas que aceptan tanto sync como async. **Ojo**: cada `await` añade un microtask, así que en hot paths puede haber overhead innecesario.

### Inferencia de tipos en `.then`

```ts
fetchUser(id)
  .then((user) => user.email)        // (user: User) => string
  .then((email) => email.length)     // (email: string) => number
  .catch((err: unknown) => {         // err: unknown desde Promise<T>
    if (err instanceof Error) console.error(err.message);
  });
```

`.then((value) => U)` devuelve `Promise<U>`. `.catch((err) => V)` devuelve `Promise<T | V>`. Encadenado, los tipos fluyen.

## Trampas comunes

1. **Olvidar `await`** — el clásico:
   ```ts
   const user = createUser(input);    // type: Promise<User>, NO User
   console.log(user.id);              // ❌ Property 'id' does not exist on type 'Promise<User>'
   ```
   TS te lo dice. En non-strict mode pasa silenciosamente.

2. **Floating promises** — `async` sin `await` ni `.catch`:
   ```ts
   async function processItems() {
     items.forEach((i) => saveAsync(i));   // ❌ promises floating, sin manejo de error
   }
   ```
   El error en `saveAsync` no se captura. En Node con `unhandledRejection` policy estricta, crashea el proceso. Fix: `await Promise.all(items.map(saveAsync))` o `for...of` + `await`.

3. **`Promise.all` corta al primer reject**:
   ```ts
   const [a, b, c] = await Promise.all([failsFast(), slow(), evenSlower()]);
   // failsFast rechaza después de 10ms → all rechaza, slow y evenSlower siguen ejecutando "huérfanos"
   ```
   Si necesitas cancelar las pendientes, usa `AbortSignal` compartido. Si necesitas todos los resultados, `allSettled`.

4. **`try/catch` con `e: unknown`** (con `useUnknownInCatchVariables`):
   ```ts
   try {
     await foo();
   } catch (e) {
     console.log(e.message);          // ❌ e is unknown
   }
   ```
   Narrowing con `instanceof Error`. Lo viste en doc 18.

5. **`return await` vs `return` en async**:
   ```ts
   async function pass() {
     return getResult();              // ✅ TS aplana; no necesitas await
   }
   async function passWithCatch() {
     try {
       return await getResult();      // ✅ `await` necesario para que el catch capture
     } catch (e) {
       handle(e);
     }
   }
   ```
   Sin el `await` dentro del try, el reject del Promise NO se captura por el catch — sale como rejection del async function externo. Regla: **`return await` cuando estás en un try**.

6. **`Promise<void>` no es `Promise<undefined>`**: ya cubierto. Sorprende cuando una API espera uno y le pasas el otro.

7. **`thenable` accidental**:
   ```ts
   class MyAwaitable {
     then(...) { ... }
   }
   const x = new MyAwaitable();
   await x;                            // funciona — TS lo considera "Promise-like"
   ```
   Útil cuando es a propósito, sorprendente cuando no.

8. **`Promise.race([])`** se queda **pendiente para siempre**: si pasas array vacío, no hay ganador. La Promise no resuelve ni rechaza, queda colgada. Idem `Promise.any([])` (este lanza `AggregateError` con array vacío). Validar arrays antes.

9. **`AbortSignal` ignorado por código viejo**: muchas libs node antiguas no respetan `signal`. Verifica la doc o usa wrappers como `p-cancelable`.

10. **`async function*` y `return`**:
    ```ts
    async function* gen() {
      yield 1;
      return 'done';   // el .return value no se incluye en for await...of
    }
    for await (const v of gen()) {
      console.log(v);   // solo 1, NO 'done'
    }
    ```
    Para obtener el return value, usa `.next()` manualmente o `Generator.return()`. Pocas veces lo necesitarás.

11. **Top-level await con isolatedModules**: `tsconfig` con `"isolatedModules": true` (activo en este repo) puede dar conflicto si tu top-level await aparece antes que cualquier `export`. Solo pasa raramente; el fix es trivial (mover el export antes).

## Ejercicio

1. **`fetchWithTimeout` aplicado al repo**: en `services/node-api/src/lib/`, crea `http.ts` con un `fetchWithTimeout<T>(url, ms): Promise<T>`. Úsalo en algún handler. Confirma que un endpoint que tarda más del timeout devuelve `AbortError`.

2. **`Promise.allSettled` con pattern matching**: dado un array de Promises que pueden fallar, escribe un `summarize` que devuelva `{ ok: T[], errors: unknown[] }`. Pista: switch sobre `r.status`.

3. **Async generator de paginación**: implementa `paginate(fetchPage)` del ejemplo. Aplica al endpoint `GET /users` (si tuviera paginación) y demuestra que recorre todas las páginas con `for await`.

4. **`Awaited<ReturnType<F>>`** type-level: extrae el tipo desempaquetado del retorno de una función async sin llamarla. Útil cuando defines tipos genéricos de "el valor que produce tal función".

5. **`return await` vs `return` en try/catch**: escribe dos versiones de la misma función. En una, `return foo()` (sin await) dentro de try/catch. En otra, `return await foo()`. Provoca un reject. ¿Cuál de las dos captura el error? Confirma que solo la segunda lo hace.

6. **Reto — race con cancelación**: implementa `firstOk(promises, signal)` que devuelve la primera Promise que resuelve y **aborta las demás** (suponiendo que aceptan signal). El comportamiento debe ser equivalente a `Promise.any` pero sin huérfanos.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 27 — *Use Functional Constructs and Libraries to Help Types Flow*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/functional.md)** — relevante para componer async ops sin perder tipos.
- **[Item 31 — *Push Null Values to the Perimeter of Your Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/null-at-perimeter.md)** — relacionado con `Promise<T | null>` vs throwing.
- **[Item 42 — *Use `unknown` Instead of `any` for Values with Unknown Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-any/unknown.md)** — directo al patrón `catch (e: unknown)`.

### Documentación oficial

- [MDN — Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) — referencia completa con todos los métodos estáticos.
- [MDN — async/await](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Async_JS/Introducing) — guía conceptual.
- [TypeScript Reference — `Awaited<Type>`](https://www.typescriptlang.org/docs/handbook/utility-types.html#awaitedtype) — la definición del utility.
- [Node.js — AbortController](https://nodejs.org/api/globals.html#class-abortcontroller) — cancelación canónica.
- [Node.js — Top-level await](https://nodejs.org/api/esm.html#top-level-await) — cuándo aplica.

### Conceptual

- [Jake Archibald — Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/) — el modelo de ejecución detrás de Promise.
- [Lin Clark — A cartoon intro to ArrayBuffers and SharedArrayBuffers](https://hacks.mozilla.org/2017/06/a-cartoon-intro-to-arraybuffers-and-sharedarraybuffers/) — no es async, pero el mismo estilo visual.
- [Anders Hejlsberg (TS lead) — TypeScript's type system](https://youtu.be/uJHD2xyv7xo) — incluye sección sobre Promise typing.

---

**Anterior:** [25 — Index signatures, `Record` y mapped types dinámicos](./25-index-signatures-y-record.md)
**Siguiente:** [27 — API design y evolución de tipos](./27-api-design-y-evolucion.md)
