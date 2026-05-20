# 16 — Utility Folder Development

> 📖 Capítulo original: [Utility Folder Development in TypeScript](https://www.totaltypescript.com/books/total-typescript-essentials/utility-folder-development-in-typescript)

## Qué cubre Matt

A pesar del título sugiriendo "cómo organizar tu folder de utilities", el capítulo se centra en **las técnicas para escribir utility functions con tipos**:

1. **Generic functions** — diferenciado de generic types (cap. 15).
2. **Type predicates** — `x is Foo`.
3. **Assertion functions** — `asserts x is Foo`.
4. **Function overloads** — múltiples firmas para una implementación.

Es el complemento "function-level" del cap. 15 que era "type-level". Material que usarás constantemente en `src/lib/`.

## Lo que importa

### Generic functions

```ts
function identity<T>(value: T): T {
  return value;
}

const a = identity(42);        // a: number (inferred)
const b = identity('hello');   // b: string
const c = identity<User>(x);   // c: User (explicit)
```

**Reglas clave**:

- **Sin explicit type argument, TS infiere desde el call**.
- **Explicit gana sobre inferido**: `identity<User>(...)` aunque `x: any`, TS confía en tu anotación.
- **No hay "un genérico"** — `identity` no es un valor; cada llamada es una instancia diferente.

```ts
function pluck<T, K extends keyof T>(arr: T[], key: K): T[K][] {
  return arr.map(x => x[key]);
}
const users = [{ name: 'Jose', age: 30 }];
const names = pluck(users, 'name');   // string[]
const ages = pluck(users, 'age');     // number[]
const bad = pluck(users, 'foo');      // ❌
```

Patrón potente: el caller no anota nada, TS infiere `T` desde el array y `K` desde la key. Verificado por `K extends keyof T`.

### Type predicates — `x is Foo`

```ts
function isString(x: unknown): x is string {
  return typeof x === 'string';
}

function f(input: unknown) {
  if (isString(input)) {
    input.toUpperCase();   // ✅ — narrow a string
  }
}
```

El `x is string` es **la firma mágica**: TS narrowea la variable en la rama true. Sin él, una función que devuelve `boolean` no comunicaría el narrow:

```ts
function isStringNaive(x: unknown): boolean {
  return typeof x === 'string';
}

function f(input: unknown) {
  if (isStringNaive(input)) {
    input.toUpperCase();   // ❌ — sigue siendo unknown
  }
}
```

**Type predicates pueden mentir** (Matt lo destaca):

```ts
function isString(x: unknown): x is string {
  return typeof x === 'number';   // ❌ bug en el predicate
}

if (isString(42)) {
  // TS cree que es string, runtime sabe que es number
  (42).toUpperCase();   // TypeError en runtime
}
```

TS confía. Si mientes en el predicate, el código aguas abajo crashea. Trátalo como `as` — herramienta poderosa, peligrosa cuando se abusa.

Cubierto a fondo en [doc 18 — Narrowing y type guards](../effectivetypescript/18-narrowing-y-type-guards.md).

### Assertion functions — `asserts x is Foo`

Variante de los predicates: **narrowea sin retornar boolean**, lanzando si no:

```ts
function assertIsString(x: unknown): asserts x is string {
  if (typeof x !== 'string') {
    throw new Error(`Expected string, got ${typeof x}`);
  }
}

function f(input: unknown) {
  assertIsString(input);
  input.toUpperCase();   // ✅ — narrow después del assert
}
```

Útil cuando "si no es lo que espero, no quiero seguir":

```ts
function loadConfig(): Config {
  const raw = readJsonSync('config.json');
  assertIsConfig(raw);
  return raw;   // narrowed a Config
}
```

Caveat: `assertIsX` también puede mentir. Si tu cuerpo `if (...)` está mal, TS te cree.

### Function overloads — múltiples firmas

```ts
function parse(input: string): number;
function parse(input: number): string;
function parse(input: string | number): string | number {
  if (typeof input === 'string') return parseInt(input);
  return String(input);
}

const a = parse('42');    // a: number
const b = parse(42);       // b: string
```

Las **declaraciones de arriba** (`parse(input: string): number;`) son las firmas públicas. La de abajo (la que tiene body) es la implementación — más amplia pero **no accesible** desde fuera.

**Cuándo overloads vs union types**:

```ts
// Union — más simple, ambiguo
function parse(input: string | number): string | number;

// Overloads — más expresivo, preserva la correlación
function parse(input: string): number;
function parse(input: number): string;
```

Con la unión, `parse(x)` devuelve `string | number` sin importar el input. Con overloads, `parse('42')` devuelve `number` exacto.

**Cuándo preferir cada uno**: para casos simples, union. Para correlación input ↔ output, overloads. Cubierto a fondo en [doc 22 — Overloads y satisfies](../effectivetypescript/22-overloads-y-satisfies.md).

## Cómo se compara con nuestro track

Solapa con varios docs:

| Tema                  | Nuestro doc                                |
|-----------------------|--------------------------------------------|
| Generic functions     | [19 — Generics avanzados](../effectivetypescript/19-generics-avanzados.md) |
| Type predicates       | [18 — Narrowing y type guards](../effectivetypescript/18-narrowing-y-type-guards.md) |
| Assertion functions   | [18](../effectivetypescript/18-narrowing-y-type-guards.md), sección "Narrowing" |
| Function overloads    | [22 — Overloads y satisfies](../effectivetypescript/22-overloads-y-satisfies.md) |

## Ideas que merecen anotarse

### "There is no 'a generic'"

Frase de Matt valiosa para nuevatos en generics:

```ts
function identity<T>(x: T): T { return x; }
const f: typeof identity;   // ¿qué tipo tiene?
```

`identity` **no es un valor** — es un "template" que TS instancia en cada call. `typeof identity` es `<T>(x: T) => T`, una function signature genérica.

Cuando pasas `identity` como callback, TS necesita una instancia concreta o un tipo "polimórfico":

```ts
arr.map(identity);   // TS infiere T por cada elemento
```

### Debugging inferred types

Cuando un genérico se comporta raro, **hover sobre la call** te muestra qué tipo se infirió. Si TS infirió `T = unknown` en lugar de `T = User`, el código aguas abajo será raro. La técnica del cap. 2 (IDE Superpowers) es **crítica** aquí.

### Constraints + defaults — la combo idiomática

```ts
function makeRepo<T extends { id: string }, ID = T['id']>(table: string) {
  return {
    findById(id: ID): Promise<T | null> { ... },
    save(entity: T): Promise<T> { ... },
  };
}

const userRepo = makeRepo<User>('users');
// ID se infiere como User['id'] = string
```

Constraints definen "qué tipos son válidos". Defaults definen "qué pasa si no especificas". Juntos = APIs concisas Y flexibles.

## Ejercicio

1. **`pluck` real**: en `services/node-api/src/lib/`, añade un `pluck<T, K extends keyof T>(arr: T[], key: K): T[K][]`. Úsalo para extraer todos los emails de un array de Users.

2. **Type predicate para ZodError**:
   ```ts
   import { ZodError } from 'zod';
   function isZodError(e: unknown): e is ZodError { ... }
   ```
   Úsalo en el `app.onError` handler para distinguir validation errors. Compara con el `instanceof ZodError` directo: ¿qué aporta el predicate?

3. **Assertion function para env**:
   ```ts
   function assertIsConfig(x: unknown): asserts x is Config { ... }
   ```
   Úsalo después de un `JSON.parse(envContent)`. Compara con Zod parsing — ¿cuál prefieres? ¿Por qué Zod es mejor a la larga?

4. **Overloads para `lookup`**:
   ```ts
   function lookup(key: 'user'): User;
   function lookup(key: 'role'): Role;
   function lookup(key: string): User | Role;
   function lookup(key: string): unknown { ... }
   ```
   Implementa. Compara con `lookup<K extends 'user' | 'role'>` con conditional return — ¿cuál es más simple?

5. **Reto — generic `tryCatch`**: refactoriza el `tryCatch` de `services/node-api/src/lib/result.ts` para que sea más genérico:
   ```ts
   async function tryCatch<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>;
   ```
   Con un parámetro `E` opcional para que el caller pueda especificar el tipo de error esperado.

## 📖 Otros recursos

- [TypeScript Handbook — More on Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html) — incluye generics, overloads, type predicates.
- [Type predicates vs assertion functions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions) — release notes donde se introdujeron las assertion functions (TS 3.7).
- [type-fest](https://github.com/sindresorhus/type-fest) — librería con muchos generic utilities ready-to-use.

---

**Anterior:** [15 — Designing Your Types](./15-designing-your-types.md)
**Siguiente:** *(fin del track Total TypeScript Essentials)*
