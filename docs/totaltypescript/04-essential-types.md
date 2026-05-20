# 04 — Essential Types and Annotations

> 📖 Capítulo original: [Essential Types and Annotations](https://www.totaltypescript.com/books/total-typescript-essentials/essential-types-and-annotations)

## Qué cubre Matt

El recorrido didáctico estándar para alguien que llega a TS: anotaciones de parámetros, variables, primitivos, inferencia, `any`, object literals, type aliases, arrays, tuples, generics aplicados a colecciones (`Set<T>`, `Map<K,V>`), y typing de funciones (optional, default, rest, return, `void`, async).

Es **el capítulo más básico del libro**. Si vienes de Java/Go/Python con experiencia, te lo lees en 10 minutos y confirmas lo que ya sabías. Si vienes nuevo a TS, paga la inversión.

## Lo más útil para un dev senior

### 1. Inferencia: la regla de oro

> Anota lo que **expones** (firmas públicas, contratos). Deja a TS inferir el resto.

```ts
// ✅ Anotar firma pública
export function findUser(id: string): User | null { ... }

// ✅ No anotar variables locales — TS infiere
const result = findUser('123');                    // inferred: User | null

// ❌ Anotación redundante
const result: User | null = findUser('123');
```

Anotar locales innecesariamente añade ruido y se sale de sync cuando refactorizas. Anotar firmas blinda los contratos. Match tu estilo a la regla.

### 2. `any` es **el último recurso**

Matt repite lo que cubrimos en [doc 18](../effectivetypescript/18-narrowing-y-type-guards.md): `any` desactiva TS para ese valor. Tres reglas:

1. **Nunca** uses `any` por pereza.
2. Si lo necesitas (interop con JS sin tipos), confínalo. Una sola línea, no propagado.
3. `unknown` casi siempre es la alternativa correcta — pide narrow, no desactiva el sistema.

### 3. Object literals vs `type` aliases

```ts
// Inline (ad-hoc, no reutilizable)
function greet(user: { name: string; email: string }) { ... }

// Type alias (reutilizable)
type User = { name: string; email: string };
function greet(user: User) { ... }
```

Matt no entra en `interface` vs `type` aquí (lo deja para más adelante). Nuestra regla práctica del [doc 23](../effectivetypescript/23-declaration-merging.md): `interface` solo cuando necesitas declaration merging; el resto, `type`.

### 4. Tuples y named tuples

```ts
// Tuple — array de longitud fija con tipos por posición
type Coord = [number, number];

// Named tuple (TS 4.0+) — labels para legibilidad
type CoordNamed = [x: number, y: number];

// Tuple opcional / rest
type Tail<T> = [first: string, ...rest: T[]];
```

Las **named tuples** mejoran el hover del IDE — verás `[x: number, y: number]` en lugar de `[number, number]`. Coste cero, valor positivo. Acostúmbrate a usarlas.

### 5. Generics aplicados a colecciones

```ts
const usersById = new Map<string, User>();    // explícito
const ids = new Set<string>();                 // explícito

const inferred = new Map([['a', 1], ['b', 2]]);   // Map<string, number> por inferencia
```

Cuándo anotas el generic vs cuándo dejas inferir:

- **Inicialización vacía** → anota: `new Map<K, V>()` (sin datos no puede inferir).
- **Inicialización con datos** → deja inferir.

### 6. `void` ≠ `undefined`

Recordatorio de [doc 26](../effectivetypescript/26-async-promise-awaited.md):

```ts
function logSomething(): void { ... }            // no devuelve nada relevante
function returnUndefined(): undefined { ... }    // explícitamente undefined
```

`Promise<void>` ≠ `Promise<undefined>`. Importa al componer.

### 7. Async return types

```ts
async function fetchUser(id: string): Promise<User> {
  return await db.users.find(id);   // si find devuelve User, esto compila
}
```

`async` envuelve el return en `Promise<T>` automáticamente. La anotación de retorno debe reflejar esto. **Si pones `async function fetchUser(): User`, TS protesta** — async functions siempre devuelven Promise.

## Cómo se compara con nuestro track

Saltamos el material de este capítulo en nuestro track porque asumimos lectores senior con experiencia en otros tipados. Las referencias relevantes en nuestro repo:

| Tema                       | Nuestro doc                                |
|----------------------------|--------------------------------------------|
| Tipado estricto + tsconfig | [02 — tsconfig estricto](../effectivetypescript/02-tsconfig-strict.md) |
| `any` y `unknown`           | [18 — Narrowing y type guards](../effectivetypescript/18-narrowing-y-type-guards.md) |
| Object types y interfaces  | [06 — Branded types](../effectivetypescript/06-branded-types.md) |
| Tuples y arrays            | [19 — Generics avanzados](../effectivetypescript/19-generics-avanzados.md) |
| Async, `Promise<T>`        | [26 — Async, Promise, Awaited](../effectivetypescript/26-async-promise-awaited.md) |

## Una idea que sí merece llevarse de aquí

### "Hover-inspect" antes de anotar

Antes de escribir un tipo explícito, **pasa el cursor** sobre lo que ya hay. Si el tipo inferido es el correcto, no anotes. Reservas las anotaciones para los casos donde:

1. La inferencia es demasiado amplia (`any[]` cuando quieres `string[]`).
2. La firma es pública (exports).
3. Quieres comunicar intent al lector futuro.

Esto encaja con el principio del cap. 2: **el tooling primero**.

## Ejercicio

1. **Audit de anotaciones redundantes** en `services/node-api/src/`: busca `const X: T = ...` donde `T` se podría inferir. ¿Cuántas hay? Quítalas. Confirma con `npm run typecheck` que sigue verde.

2. **Named tuples sobre un Result**: en lugar de `{ ok: true; value: T }`, modela un Result como named tuple: `type Result<T, E> = [ok: true, value: T] | [ok: false, error: E]`. ¿Cómo se siente comparado con el discriminated union actual del [doc 04](../effectivetypescript/04-result-type.md)? ¿Cuál prefieres?

3. **`new Map<K, V>()` vs inferencia**: en `services/node-api/src/lib/`, busca cualquier `new Map(...)` o `new Set(...)`. ¿Tiene anotación explícita? ¿La necesita?

4. **`async function: User` vs `async function: Promise<User>`**: intenta declarar `async function f(): User { return user; }`. ¿Qué error de TS sale? Por qué.

5. **Reto — refactor a tuples + destructuring**: convierte una función que devuelve `{ data: T; error: null } | { data: null; error: E }` (clásico "either" mal modelado) a `[T, null] | [null, E]`. Destructuring: `const [data, error] = await ...`. ¿Cuál es más legible? ¿Cuál más type-safe?

## 📖 Otros recursos

- [TypeScript Handbook — Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) — referencia oficial de los primitivos y básicos.
- [Effective TypeScript — Item 19: Avoid Cluttering Your Code with Inferable Types](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/inferable.md) — la regla "no anotes lo que se infiere".

---

**Anterior:** [03 — TypeScript In The Development Pipeline](./03-development-pipeline.md)
**Siguiente:** [05 — Unions, Literals, and Narrowing](./05-unions-literals-narrowing.md)
