# 21 — Template literal y mapped types

## El problema

Dos herramientas que se usan juntas y multiplican su poder:

- **Template literal types** — strings con interpolación a nivel de tipo. Sirven para modelar rutas, eventos, queries, DSLs.
- **Mapped types** — transformar un tipo objeto en otro recorriendo sus claves. Sirven para `Partial`, `Pick`, `Readonly`… y los tuyos.

Juntos te dan herramientas para escribir APIs que son **imposibles de usar mal**: el compilador valida la forma de tus strings y la forma de tus objetos al mismo tiempo.

## Template literal types — strings a nivel de tipo

```ts
type Greeting = `hello, ${string}`;
const a: Greeting = 'hello, world';  // ✅
const b: Greeting = 'goodbye, world'; // ❌
```

`${string}` es un **placeholder**: acepta cualquier string. Pero también puedes interpolar tipos concretos:

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Endpoint  = `/${string}`;
type Route     = `${HttpMethod} ${Endpoint}`;

const r1: Route = 'GET /users';    // ✅
const r2: Route = 'PATCH /users';  // ❌ PATCH no está en HttpMethod
```

Al combinar uniones, TS hace el **producto cartesiano**:

```ts
type Size  = 'sm' | 'md' | 'lg';
type Color = 'red' | 'blue';
type Class = `${Size}-${Color}`;
//   ^? 'sm-red' | 'sm-blue' | 'md-red' | 'md-blue' | 'lg-red' | 'lg-blue'
```

Útil para tipar variantes de Tailwind, claves de i18n, eventos de un EventBus, etc.

### Operaciones built-in sobre strings literales

TS trae cuatro utilidades para manipular strings a nivel de tipo:

```ts
type A = Uppercase<'hello'>;    // 'HELLO'
type B = Lowercase<'HELLO'>;    // 'hello'
type C = Capitalize<'hello'>;   // 'Hello'
type D = Uncapitalize<'Hello'>; // 'hello'
```

Combinadas con templates, son potentes:

```ts
type Getter<K extends string> = `get${Capitalize<K>}`;
type T = Getter<'name'>; // 'getName'
```

### Parsear con `infer`

`infer` dentro de template literals es donde la cosa se pone seria. Puedes **extraer partes** de un string:

```ts
type FirstSegment<S extends string> = S extends `/${infer Head}/${string}`
  ? Head
  : never;

type A = FirstSegment<'/users/123/posts'>; // 'users'
```

Y aplicado a rutas estilo Express o Hono:

```ts
type RouteParams<S extends string> =
  S extends `${string}:${infer Param}/${infer Rest}`
    ? Param | RouteParams<`/${Rest}`>
    : S extends `${string}:${infer Param}`
      ? Param
      : never;

type P = RouteParams<'/users/:id/posts/:postId'>;
//   ^? 'id' | 'postId'
```

A partir de aquí puedes tipar un router:

```ts
type Handler<Path extends string> = (
  params: Record<RouteParams<Path>, string>,
) => Response;

const getUser: Handler<'/users/:id'> = (params) => {
  params.id;   // ✅ string
  params.foo;  // ❌ Property 'foo' does not exist
};
```

Hono y otras libs hacen exactamente esto por dentro para tipar `c.req.param()`.

## Mapped types — transformar tipos objeto

La sintaxis básica:

```ts
type Mutable<T> = {
  [K in keyof T]: T[K];
};
```

Léelo: "para cada clave `K` de `T`, su tipo es `T[K]`". Por sí solo es un no-op (clona el tipo). Lo útil viene cuando **modificas** algo en el camino.

### Modificadores `readonly` y `?`

```ts
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

type Partial<T> = {
  [K in keyof T]?: T[K];
};
```

Puedes **añadir** (`readonly`, `?`) y **quitar** (`-readonly`, `-?`):

```ts
type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

type Required<T> = {
  [K in keyof T]-?: T[K];
};
```

`Partial`, `Required`, `Readonly` son built-in. `Mutable` no — implementarlo a mano es trivial.

### `Pick` y `Omit` — filtrar claves

```ts
type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
};

type User = { id: string; name: string; email: string; password: string };
type PublicUser = Pick<User, 'id' | 'name' | 'email'>;
```

`Omit` es lo opuesto pero está implementado con `Exclude` (conditional type) sobre las claves:

```ts
type Omit<T, K> = Pick<T, Exclude<keyof T, K>>;
type SafeUser = Omit<User, 'password'>;
```

### Key remapping con `as`

TS 4.1 añadió la capacidad de **renombrar** las claves durante el mapeo:

```ts
type Getters<T> = {
  [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K];
};

type User = { name: string; age: number };
type UserGetters = Getters<User>;
// {
//   getName: () => string;
//   getAge: () => number;
// }
```

Tres partes:
1. **`K in keyof T`** — iterar.
2. **`as <nuevo nombre>`** — renombrar usando templates.
3. **El tipo del valor** — puede usar `T[K]`.

Combinado con `never` puedes **filtrar claves**:

```ts
type RemovePassword<T> = {
  [K in keyof T as K extends 'password' ? never : K]: T[K];
};

type Safe = RemovePassword<User>;
// { id: string; name: string; email: string }
```

Una clave mapeada a `never` **desaparece** del resultado.

## Patrón real para este repo — DTOs

Imagina que tu repositorio devuelve `User` y quieres una versión sin sensitive fields para serializar al cliente:

```ts
type Sensitive = 'password' | 'sessionToken';

type Public<T> = {
  [K in keyof T as K extends Sensitive ? never : K]: T[K];
};

type User = {
  id: string;
  name: string;
  email: string;
  password: string;
  sessionToken: string;
};

type PublicUser = Public<User>;
// { id: string; name: string; email: string }
```

Si mañana añades un nuevo campo sensible (`oauthRefreshToken`), basta extender `Sensitive`. **Todos los DTOs derivados se actualizan**.

Lo mismo pero para hacer todos los campos opcionales para un PATCH endpoint:

```ts
type UpdateInput<T> = Partial<Omit<T, 'id' | 'createdAt'>>;

type UpdateUserInput = UpdateInput<User>;
// { name?: string; email?: string; password?: string; sessionToken?: string }
```

## Combinando los dos — eventos tipados

```ts
type Events = {
  user_created: { id: string; email: string };
  user_deleted: { id: string };
  order_placed: { orderId: string; total: number };
};

type EventName = keyof Events;

type EventHandlers = {
  [K in EventName as `on${Capitalize<K & string>}`]: (payload: Events[K]) => void;
};

// EventHandlers = {
//   onUser_created: (payload: { id: string; email: string }) => void;
//   onUser_deleted: (payload: { id: string }) => void;
//   onOrder_placed: (payload: { orderId: string; total: number }) => void;
// }
```

Y un `emit` tipado:

```ts
function emit<K extends EventName>(event: K, payload: Events[K]): void {
  // ...
}

emit('user_created', { id: '1', email: 'x@y.z' });    // ✅
emit('user_created', { id: '1' });                     // ❌ falta email
emit('user_deleted', { id: '1', email: 'extra' });    // ❌ propiedad extra
emit('foo', { id: '1' });                              // ❌ evento inexistente
```

Este patrón aparece en bibliotecas como `mitt`, `tiny-emitter` tipadas, o handlers de eventos de Hono/Express.

## Mapped types sobre uniones — usa `[T] extends [...]`

Atención a la distribución:

```ts
type Wrap<T> = {
  [K in keyof T]: { value: T[K] };
};

type W = Wrap<{ a: 1 } | { b: 2 }>;
// ¿qué da?
```

Si `T` es una unión, `keyof T` da las claves **comunes** (`never` aquí, no hay claves compartidas). El resultado es `{}`.

Para mapear cada miembro por separado, distribuye con un conditional:

```ts
type Wrap<T> = T extends any ? { [K in keyof T]: { value: T[K] } } : never;

type W = Wrap<{ a: 1 } | { b: 2 }>;
// { a: { value: 1 } } | { b: { value: 2 } }
```

El `T extends any ? ... : never` **es solo una manera de forzar distribución**. No filtra nada (`any` lo acepta todo), solo activa el comportamiento distributivo de los conditional types.

## Trampas comunes

1. **`K & string`** cuando interpolas claves:
   ```ts
   type Getter<T> = { [K in keyof T as `get${K}`]: () => T[K] };
   //                                     ^^^ K puede ser string | number | symbol
   ```
   `keyof T` incluye `symbol` por defecto si `T` tiene métodos `Symbol.iterator` etc. Los templates solo admiten string. Solución: `K & string`:
   ```ts
   type Getter<T> = { [K in keyof T as `get${Capitalize<K & string>}`]: ... };
   ```

2. **`Partial` no es recursivo**:
   ```ts
   type P = Partial<{ a: { b: number } }>;
   // { a?: { b: number } }  ← b sigue siendo required
   ```
   Si quieres "todo opcional en profundidad", escríbete un `DeepPartial`. Hay una razón para que no sea built-in: la recursión sobre tipos complejos puede explotar el compilador.

3. **`Omit` no protege contra typos**:
   ```ts
   type T = Omit<User, 'passwrod'>; // ✅ TS no protesta
   ```
   La firma original de `Omit` permite **cualquier** clave en `K`, incluso las que no existen. Si te importa la safety, escríbete `StrictOmit<T, K extends keyof T> = Omit<T, K>`.

4. **Claves numéricas y `Capitalize`**:
   ```ts
   type Bad = Capitalize<1>; // ❌
   ```
   `Capitalize` y compañía solo aceptan strings. Filtra con `K & string`.

5. **`as never` versus omitir la propiedad**:
   ```ts
   type X = { a: 1; b: 2 } & { a: never };
   // { a: never; b: 2 }  ← propiedad sigue existiendo
   ```
   `never` como **tipo de valor** es una propiedad imposible de asignar. Si lo que quieres es **quitar** la propiedad, usa key remapping con `as never`, no value `: never`.

## Ejercicio

1. **Implementa `DeepPartial<T>`** que aplique `Partial` recursivamente. Cuidado con arrays — `Array<Foo>` debe ir como `Array<DeepPartial<Foo>>`, no como `Partial<Array<Foo>>`.

2. **`PrefixKeys<T, P>`**: dada `{ name: string; age: number }` y prefijo `'user_'`, devuelve `{ user_name: string; user_age: number }`. Usa templates + key remapping.

3. **Filtrar por tipo de valor**: implementa `PickByType<T, V>` que se quede con las claves cuyo valor sea de tipo `V`:
   ```ts
   type T = PickByType<{ a: number; b: string; c: number }, number>;
   // { a: number; c: number }
   ```

4. **Tipar Hono routes**: define `type RouteParams<S>` como en el doc, y úsalo en el repo. Crea un wrapper sobre `c.req.param()` que devuelva tipos correctos para una ruta `/users/:id`.

5. **Reto — keys de Zod schema**: dado `const s = z.object({ a: z.string(), b: z.number() })`, escribe un tipo que extraiga `'a' | 'b'` (las claves del shape). Pista: `typeof s.shape` te da el shape como objeto plano.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 14 — *Use `readonly` to Avoid Errors Associated with Mutation*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/readonly.md)** — `readonly`, base para los modifiers en mapped types.
- **[Item 15 — *Use Type Operations and Generic Types to Avoid Repeating Yourself*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/dry.md)** — `Pick`, `Omit`, `Partial` aplicados a DTOs sin repetición.
- **[Item 53 — *Use Template Literal Types to Model DSLs and Relationships Between Strings*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/template-literals.md)** — el item de referencia para templates.

---

**Anterior:** [20 — Conditional types e `infer`](./20-conditional-types-e-infer.md)
**Siguiente:** [22 — Overloads y `satisfies`](./22-overloads-y-satisfies.md)
