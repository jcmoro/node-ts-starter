# 10 — Deriving Types

> 📖 Capítulo original: [Deriving Types](https://www.totaltypescript.com/books/total-typescript-essentials/deriving-types)

## Qué cubre Matt

Las herramientas centrales para **derivar tipos a partir de otros tipos** — el corazón del type-level programming:

1. **`keyof`** — extraer las keys de un object type como union.
2. **`typeof`** — extraer el tipo de un runtime value.
3. **Indexed access types** (`T[K]`) — leer un tipo desde otro.
4. **`as const` para JS-style enums** (cubierto en cap. 9 y nuestro doc 06 ampliado).
5. **Function-derived types**: `Parameters<F>`, `ReturnType<F>`, `Awaited<T>`.
6. **Union-transforming utility types**: `Exclude`, `Extract`, `NonNullable`.
7. **Deriving vs decoupling** — la decisión filosófica de cuándo derivar y cuándo no.

## Lo que importa

### `keyof`

```ts
type User = { id: string; email: string; name: string };
type UserKey = keyof User;   // 'id' | 'email' | 'name'

function get<K extends keyof User>(user: User, key: K): User[K] {
  return user[key];
}
get(user, 'id');     // returns string
get(user, 'email');  // returns string
get(user, 'foo');    // ❌ — 'foo' is not assignable to keyof User
```

**El benchmark**: `keyof` se sincroniza automáticamente con cambios al tipo. Añade `age: number` a `User` → `keyof User` lo incluye sin tocar nada.

### `typeof` — del valor al tipo

```ts
const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 3000,
  ssl: false,
};

type Config = typeof DEFAULT_CONFIG;
// = { host: string; port: number; ssl: boolean }

function override(opts: Partial<Config>): Config { ... }
```

Útil cuando ya tienes un objeto literal y quieres su tipo sin reescribirlo. Combinado con `as const`:

```ts
const ROLES = ['admin', 'user', 'guest'] as const;
type Role = typeof ROLES[number];   // 'admin' | 'user' | 'guest'
```

**No hay `valueof`** — TypeScript no permite generar valores runtime desde tipos. La dirección solo va `value → type`.

### Indexed access types

```ts
type User = { profile: { email: string; verified: boolean } };

type Profile = User['profile'];
// = { email: string; verified: boolean }

type Email = User['profile']['email'];
// = string

type ProfileFields = User['profile'][keyof User['profile']];
// = string | boolean
```

El patrón `T[keyof T]` te da **la unión de todos los tipos de valores** de un object type. Aparece a menudo en mapped types y generics utility.

### Function-derived: `Parameters`, `ReturnType`, `Awaited`

Cubiertos en nuestro [doc 26 — Async](../effectivetypescript/26-async-promise-awaited.md):

```ts
function fetchUser(id: string): Promise<User> { ... }

type Params = Parameters<typeof fetchUser>;       // [id: string]
type Return = ReturnType<typeof fetchUser>;       // Promise<User>
type Resolved = Awaited<ReturnType<typeof fetchUser>>;  // User
```

Patrón típico: derivar el tipo "lo que tal API devuelve, después de unwrapping Promises" sin escribir el tipo a mano. Útil cuando consumes una función de una lib sin tipos exportados directamente.

### `Exclude`, `Extract`, `NonNullable`

```ts
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

type Active = Exclude<Status, 'cancelled'>;   // 'pending' | 'approved' | 'rejected'
type Final = Extract<Status, 'approved' | 'rejected'>;  // 'approved' | 'rejected'

type Maybe = User | null | undefined;
type Defined = NonNullable<Maybe>;   // User
```

Bajo el capó son **conditional types distributivos** (cubierto en [doc 20](../effectivetypescript/20-conditional-types-e-infer.md)):

```ts
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type NonNullable<T> = T extends null | undefined ? never : T;
```

### El debate "deriving vs decoupling"

Matt cierra el capítulo con la pregunta filosófica clave del type-level programming:

> Should I derive this type from another, or write it independently?

**Argumentos para derivar:**
- Single source of truth — cambios se propagan.
- Menos código.
- Imposible que los dos tipos divergen accidentalmente.

**Argumentos para decoupling (escribir independiente):**
- Si el tipo evoluciona por razones distintas al original, derivar atrincherca el acoplamiento.
- Errores de inferencia complejos cuando la derivación es profunda.
- Hacks tipo `Pick<T, Exclude<keyof T, '...'>>` son menos legibles que escribir el tipo explicit.

**La regla heurística de Matt**:

> Derive when both types describe the **same domain concept**. Decouple when they describe **different concerns that happen to overlap in shape today**.

Ejemplo:
- ✅ `type UserPublic = Omit<User, 'password'>` — la misma entidad, solo público. Derivar.
- ❌ `type ApiUserDto = Pick<UserEntity, ...>` — UI puede evolucionar independiente del modelo persistente. Decouplear.

## Cómo se compara con nuestro track

Este capítulo solapa con varios de nuestros docs avanzados:

- [Doc 19 — Generics avanzados](../effectivetypescript/19-generics-avanzados.md): `keyof`, constraints, type extraction.
- [Doc 20 — Conditional types e `infer`](../effectivetypescript/20-conditional-types-e-infer.md): la mecánica de `Exclude`, `Extract`, etc.
- [Doc 21 — Template literal y mapped types](../effectivetypescript/21-template-literal-y-mapped-types.md): `Pick`, `Omit`, mapped types custom.
- [Doc 26 — Async, `Promise<T>`, `Awaited<T>`](../effectivetypescript/26-async-promise-awaited.md): `Awaited` y function-derived types.

El capítulo de Matt es **una buena vista de conjunto**. Nuestros docs profundizan cada herramienta.

## Ideas que merecen anotarse

### "Single source of truth" via deriving — el patrón Zod

Zod (que usamos en el repo) lleva este principio al extremo:

```ts
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
});

type User = z.infer<typeof UserSchema>;
//   ^^^ tipo derivado del schema — un único sitio donde se declara
```

Si añades `age: z.number()` al schema, el tipo `User` lo incluye automáticamente. **No hay forma de que el tipo divergen del runtime validation**. Es deriving llevado al extremo.

### Indexed access con uniones es distributivo

```ts
type T = { a: string; b: number; c: boolean };
type Pick<T, 'a' | 'b'>;       // { a: string; b: number }
type T['a' | 'b'];              // string | number — ojo, NO {a, b}
```

Confunde al principio. `T[K]` con `K` siendo unión devuelve **la unión de los tipos de esas keys**, no un sub-object. Para sub-object, `Pick<T, K>`.

### `as const` para POJO enums — la mejor alternativa

Matt y nosotros (cap. 7 y 9) recomendamos:

```ts
const Status = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const;

type Status = typeof Status[keyof typeof Status];
// = 'pending' | 'approved' | 'rejected'
```

Combinado: object literal con valores, plus `as const`, plus `typeof X[keyof typeof X]` para extraer la unión. Tree-shakeable, sin reverse mapping, estructural.

## Ejercicio

1. **`keyof` para acceso safe**: en `services/node-api/`, busca algún código que haga `obj[key]` donde `key` viene de `string`. Refactoriza a `K extends keyof T` para forzar safety. Confirma que el typecheck rechaza keys inexistentes.

2. **Derivar tipo desde Zod schema**: el repo ya usa `z.infer<typeof UserSchema>`. Audit: ¿hay algún tipo escrito a mano que duplica info de un schema? Si sí, refactoriza a derivado.

3. **`Parameters<F>` y `ReturnType<F>` en práctica**: tienes una función `createUser(req: CreateUserRequest): Promise<User>`. Define un type `CreateUserHandler` que es exactamente esa firma, derivado:
   ```ts
   type CreateUserHandler = (...args: Parameters<typeof createUser>) => ReturnType<typeof createUser>;
   ```
   ¿Aporta? ¿En qué casos sí, en cuáles es over-engineering?

4. **`Exclude` para "estados finales"**: dado `type Status = 'pending' | 'approved' | 'rejected' | 'cancelled'`, define `type ActiveStatus = Exclude<Status, 'cancelled'>`. Úsalo en una función que solo trabaja con estados activos.

5. **Debate concreto**: en el repo, los DTOs HTTP (`CreateUserRequest`) son distintos a la entidad (`User`). ¿Deberían derivarse uno del otro (`Pick<User, 'email' | 'name'>`)? ¿Por qué sí/no? Defiende tu posición con un argumento de evolución (cap. 27 - API design).

## 📖 Otros recursos

- [TypeScript Handbook — Keyof Type Operator](https://www.typescriptlang.org/docs/handbook/2/keyof-types.html)
- [TypeScript Handbook — Typeof Type Operator](https://www.typescriptlang.org/docs/handbook/2/typeof-types.html)
- [TypeScript Handbook — Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html)
- [Effective TypeScript — Item 14: Use Type Operations and Generics to Avoid Repetition](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/dry.md) — el caso DRY para deriving.

---

**Anterior:** [09 — TypeScript-only Features](./09-typescript-only-features.md)
**Siguiente:** [11 — Annotations and Assertions](./11-annotations-and-assertions.md)
