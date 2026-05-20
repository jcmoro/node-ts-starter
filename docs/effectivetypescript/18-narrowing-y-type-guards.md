# 18 — Narrowing y type guards (+ unknown/any/never)

## El problema

En TS estricto, los datos del exterior llegan con tipos amplios — `unknown`, uniones, opcionales. Para usarlos hay que **estrecharlos** (narrow) hasta un tipo concreto.

```ts
function handle(input: unknown) {
  input.toLowerCase(); // ❌ Object is of type 'unknown'
}
```

`unknown` no permite **nada** hasta que pruebes qué es. Esa prueba es **narrowing**, y la herramienta para hacerlo se llama **type guard**.

Si vienes de Java, esto se parece a `instanceof` + cast — pero el motor de inferencia de TS lo hace **sin cast**: el compilador recuerda lo que probaste y ajusta el tipo de la variable en cada rama.

## Las cuatro vías de narrowing

### 1. `typeof` — para primitivos

```ts
function double(x: string | number): string | number {
  if (typeof x === 'string') {
    return x.repeat(2); // x: string
  }
  return x * 2;         // x: number
}
```

`typeof` solo distingue primitivos de JS: `'string' | 'number' | 'boolean' | 'bigint' | 'symbol' | 'undefined' | 'object' | 'function'`. Cuidado: `typeof null === 'object'` y `typeof [] === 'object'`. JS heredó esos bugs y `typeof` los heredó también.

### 2. `instanceof` — para clases

```ts
function logError(e: unknown) {
  if (e instanceof Error) {
    console.error(e.message); // e: Error
  } else {
    console.error(String(e));
  }
}
```

Funciona con cualquier clase. Es el patrón estándar para `catch (e: unknown)` — el mismo que ya viste en `src/lib/result.ts` dentro de `tryCatch`.

> 💡 **Analogía Java**: idéntico semánticamente. La diferencia: en TS no necesitas castear después (`Error e = (Error) ex`); el compilador ya lo hace solo.

### 3. `in` — para propiedades

```ts
type Cat = { meow: () => void };
type Dog = { bark: () => void };

function speak(animal: Cat | Dog) {
  if ('meow' in animal) {
    animal.meow(); // animal: Cat
  } else {
    animal.bark(); // animal: Dog
  }
}
```

Útil cuando las clases no son nominales (es decir, casi siempre en TS, por el tipado estructural). Pregunta "¿este objeto tiene esta propiedad?" y narrowea por la respuesta.

### 4. Discriminante — para unions etiquetadas

Ya lo viste en el doc 04 con `Result`:

```ts
if (r.ok) { r.value; } else { r.error; }
```

Es **el patrón más limpio**. Cuando diseñas un union, **añade siempre un campo discriminante** (`kind`, `type`, `ok`, `status`) — TS narrowea sobre él sin esfuerzo.

## Type predicates: cuando los cuatro no bastan

A veces necesitas una función reutilizable que diga "este `unknown` es un `Foo`". La firma normal no narrowea:

```ts
function isString(x: unknown): boolean {
  return typeof x === 'string';
}

function f(x: unknown) {
  if (isString(x)) {
    x.toUpperCase(); // ❌ x sigue siendo unknown
  }
}
```

`isString` devuelve `boolean` — TS no sabe que `true` implica que `x` es `string`. Hay que **decírselo** con un **type predicate**:

```ts
function isString(x: unknown): x is string {
  return typeof x === 'string';
}
```

`x is string` es la firma mágica. Significa: "si esta función devuelve `true`, asume que `x` es `string` en la rama que sigue".

Ejemplo en este repo. Imagina un helper para validar errores de Hono:

```ts
type HttpError = { kind: 'http'; status: number; message: string };

function isHttpError(e: unknown): e is HttpError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'kind' in e &&
    (e as { kind: unknown }).kind === 'http'
  );
}

app.onError((err, c) => {
  if (isHttpError(err)) {
    return c.json({ error: err.message }, err.status); // err: HttpError
  }
  return c.json({ error: 'Internal error' }, 500);
});
```

### Trampa: el predicate **te cree**

```ts
function isString(x: unknown): x is string {
  return typeof x === 'number'; // ¡bug!
}
```

TS no verifica que el cuerpo sea consistente con la firma. Si mientes, TS te cree y todo el código aguas abajo se contamina. Es un cast disfrazado — trátalo con el mismo cuidado que un `as`.

> 💡 **Mental model**: un type predicate es una **promesa** firmada por ti. TS la respeta. Si miente, no compila el código pero crashea el runtime.

## Exhaustive checks con `never`

Cuando trabajas con una discriminated union, quieres garantía **compile-time** de que cubres todos los casos. El truco: pasarla a una función que solo acepta `never`.

```ts
function assertNever(x: never): never {
  throw new Error(`Unexpected variant: ${JSON.stringify(x)}`);
}

type Event =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'keypress'; key: string }
  | { kind: 'scroll'; delta: number };

function describe(e: Event): string {
  switch (e.kind) {
    case 'click':    return `click ${e.x},${e.y}`;
    case 'keypress': return `key ${e.key}`;
    case 'scroll':   return `scroll ${e.delta}`;
    default:         return assertNever(e); // ✅
  }
}
```

Si mañana añades `{ kind: 'hover'; element: string }` a `Event`, TS error en `assertNever(e)`: "Argument of type 'Event' is not assignable to parameter of type 'never'". El compilador te obliga a manejarlo.

Si quitas el `default` con `assertNever`, TS sigue compilando aunque te dejes un caso — silenciosamente. **El `assertNever` es el cinturón de seguridad**.

> 💡 **Comparación**: en Java esto es lo que harían `sealed classes` + pattern matching exhaustivo. En Go, no existe — tienes que confiar en linters.

## `unknown` vs `any` vs `never`

Tres tipos especiales. Confundirlos es uno de los errores que más cuesta detectar.

### `any` — el escape hatch

```ts
const x: any = 'hello';
x.foo.bar.baz; // ✅ compila, crashea en runtime
```

`any` **desactiva el sistema de tipos** para ese valor. Cualquier operación pasa. Es **veneno**: una vez que un `any` se mete en tu código, contamina todo lo que toca. Variables que reciben un `any` se vuelven `any`. Parámetros que reciben `any` se vuelven `any`.

Reglas prácticas:

- **Nunca** uses `any` por pereza.
- Si lo necesitas (interop con código sin tipar), confínalo: una asignación, una función pequeña, y vuelve a `unknown` o un tipo concreto cuanto antes.
- `// @ts-expect-error` con un comentario explicando por qué es mejor que un `any` silencioso.

### `unknown` — el `any` seguro

```ts
const x: unknown = 'hello';
x.toUpperCase(); // ❌ Object is of type 'unknown'
```

`unknown` es el "**top type**": cualquier valor cabe en él. **No permite ninguna operación** hasta que narroweas. Es lo que querías que fuera `any`.

Úsalo para:

- Datos del exterior antes de validar (`JSON.parse` devuelve `any` por defecto — castea a `unknown` si puedes).
- Catch clauses (`catch (e: unknown)` con `useUnknownInCatchVariables`, activado en nuestro `tsconfig`).
- APIs genéricas que reciben "lo que sea" y luego narrowean.

Regla: **`unknown` está en el borde, no en el centro**. Si tu lógica de negocio recibe `unknown`, hay un validador que no hiciste.

### `never` — el "bottom type"

```ts
function fail(): never {
  throw new Error('boom');
}
```

`never` es el "**bottom type**": un valor que **no puede existir**. Cabe en cualquier tipo (es subtipo de todo), pero ningún valor cabe en él (excepto los del propio `never`).

Usos:

- Tipo de retorno de funciones que **nunca retornan** (`throw`, `while(true)`).
- Rama "imposible" de un narrowing (lo que sobra después de cubrir todos los casos).
- Marcar variantes vacías de un union genérico (`Result<T, never>` significa "este Result no puede fallar").

```ts
function process(x: string | number) {
  if (typeof x === 'string') return x.length;
  if (typeof x === 'number') return x.toFixed(2);
  // aquí x: never — ya cubrimos todos los casos
}
```

### El cuadro mental

```
        any
       /   \
   unknown  todo lo demás (any es ambas)
      |
   string, number, User, ...
      |
     null, undefined
      |
    never
```

- **`any`** está fuera de la jerarquía — TS lo trata como "compatible con todo en ambas direcciones", lo cual es justo lo malo.
- **`unknown`** es el techo: todo cabe arriba, nada baja sin pasar control.
- **`never`** es el suelo: nada llega aquí salvo lo imposible.

## Truco: narrowing y let vs const

```ts
let x: string | number = 'a';
if (typeof x === 'string') {
  // x: string
  reassignSomewhere(); // si esta función modifica x, TS no se entera
  x.toUpperCase();     // ⚠️ TS sigue creyendo que x: string
}
```

TS asume que entre la guard y el uso, **nadie cambia `x`**. Si la rebote a un `number` desde una callback o un side-effect, el narrowing queda obsoleto y TS no lo detecta. Solución: usa `const` siempre que puedas. Y si tienes que mutar, vuelve a guard.

```ts
const x: string | number = 'a';
// imposible cambiar — el narrowing es seguro
```

## Narrowing y funciones

Cuando llamas a una función dentro del narrowed block, TS **invalida el narrowing**:

```ts
type State = { user: User | null };
function process(s: State) {
  if (s.user !== null) {
    callback(); // función arbitraria — podría mutar s.user
    s.user.name; // ❌ Object is possibly 'null'
  }
}
```

TS es pesimista: cualquier función podría modificar `s.user`. La cura: extrae a una variable local.

```ts
if (s.user !== null) {
  const user = s.user;
  callback();
  user.name; // ✅
}
```

Esto es **idiomático** en TS. Vas a hacerlo a menudo.

## Trampas comunes

1. **`!= null` cubre dos cosas**:
   ```ts
   if (x != null) { /* x no es null ni undefined */ }
   if (x !== null) { /* x sigue pudiendo ser undefined */ }
   ```
   El `!=` (no `!==`) es la única excepción donde la doble igualdad es deseable. Cubre los dos casos a la vez. Es **idiomático en TS**.

2. **Truthy checks engañan con `0` y `''`**:
   ```ts
   if (str) { /* falsy también con '' */ }
   ```
   Si `str: string | undefined`, `if (str)` excluye `undefined` **y** la cadena vacía. Si querías solo excluir `undefined`, usa `if (str !== undefined)`.

3. **`typeof null === 'object'`**: si quieres distinguir `null` de un objeto, comprueba `=== null` antes.

4. **Optional chaining no narrowea**:
   ```ts
   if (user?.name) {
     user.name; // ❌ user sigue siendo User | undefined
   }
   ```
   Lo que narroweas es `user?.name`, no `user`. Si necesitas usar `user` después, hazlo explícito:
   ```ts
   if (user !== undefined && user.name) {
     user.name; // ✅
   }
   ```

5. **`Array.isArray` con readonly**:
   ```ts
   function f(x: readonly number[] | number) {
     if (Array.isArray(x)) {
       x; // x: number[] (¡pierde readonly!)
     }
   }
   ```
   `Array.isArray` está tipado pobremente y desnarrowea a array mutable. Si te importa preservar `readonly`, hazte un type predicate propio.

## Ejercicio

1. **Type predicate sobre `ZodError`**: en `src/app.ts` o donde manejes errores, escribe `function isZodError(e: unknown): e is z.ZodError` y úsalo en el handler de `app.onError`. Comprueba que dentro del `if`, `e` tiene `.issues`.

2. **`assertNever` real**: añade un campo `role: 'admin' | 'user' | 'guest'` a `User`. Escribe `function permissions(role: User['role']): string[]` con un `switch` y `assertNever` en el `default`. Quita un caso y observa el error de compilación.

3. **De `unknown` a tipo concreto a mano**: escribe `function parseConfig(raw: unknown): Config` sin usar Zod. Comprueba propiedad a propiedad con `in` + `typeof`. ¿Sientes el dolor? Esa es la razón por la que existe Zod. Borra el ejercicio.

4. **`never` como guardián de unions**: convierte `tryCatch` en `src/lib/result.ts` para que su firma diga `Result<T, never>` cuando la función no falla, y `Result<T, Error>` cuando puede fallar. Pista: solo afecta a las firmas de `ok` y `err`, no a `tryCatch` mismo.

5. **Reto**: escribe un type predicate genérico `function has<K extends string>(obj: object, key: K): obj is Record<K, unknown>`. Úsalo para narrowear `unknown` con `'foo' in x` de forma reutilizable.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 5 — *Limit Use of the `any` Type*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-intro/any-limit.md)** — por qué `any` es un agujero y cómo confinarlo.
- **[Item 22 — *Understand Type Narrowing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/narrowing.md)** — el item de referencia. Cubre las cuatro vías y los predicates.
- **[Item 42 — *Use `unknown` Instead of `any` for Values with Unknown Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-any/unknown.md)** — `unknown` como `any` seguro, con ejemplos.
- **[Item 59 — *Use `never` Types to Perform Exhaustiveness Checking*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/exhaustiveness.md)** — el patrón `assertNever`.

---

**Anterior:** [17 — Stack observabilidad](./17-observabilidad-stack.md)
**Siguiente:** [19 — Generics avanzados](./19-generics-avanzados.md)
