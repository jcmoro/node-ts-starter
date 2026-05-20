# 06 — Objects

> 📖 Capítulo original: [Objects](https://www.totaltypescript.com/books/total-typescript-essentials/objects)

## Qué cubre Matt

Tres bloques:

1. **Componer objetos**: `interface extends`, intersection types (`A & B`), comparación `type` vs `interface`.
2. **Keys dinámicas**: index signatures, `Record<K,V>`, `PropertyKey`, el tipo built-in `object`.
3. **Utility types para reducir duplicación**: `Partial`, `Required`, `Pick`, `Omit`.

Es un capítulo "fundamentos sólidos" — material que ya cubrimos a fondo en varios sitios, pero su framing unificado (todo el "trabajar con objetos" en un sitio) es útil.

## Lo más relevante

### `interface extends` vs intersection (`&`)

```ts
// Intersection
type Animal = { name: string };
type Dog = Animal & { breed: string };

// Interface extends
interface Animal { name: string }
interface Dog extends Animal { breed: string }
```

Matt destaca que **`interface extends` produce mejores mensajes de error** y mejor performance del compilador en codebases grandes. Los conflictos se reportan en la línea del extends; con intersection, los conflictos pueden manifestarse lejos del origen.

Regla práctica de Matt:

> **Prefer `interface extends` over intersection** when you mean "this is that, plus more".

Nuestra regla del [doc 23](../effectivetypescript/23-declaration-merging.md): `interface` solo cuando necesitas declaration merging; el resto, `type`. Las dos reglas son compatibles si la mayoría de tus tipos no necesitan `extends`. Si tu codebase tiene mucha herencia de tipos, vale la pena reconsiderar — pero **estamos en territorio de matiz**, no hay una respuesta universal.

### Index signatures vs `Record<K, V>`

Cubierto a fondo en nuestro [doc 25](../effectivetypescript/25-index-signatures-y-record.md). Resumen rápido:

```ts
type WithIndex = { [key: string]: number };
type WithRecord = Record<string, number>;
// ≈ equivalentes para keys infinitas (string/number/symbol)

type ExhaustiveRecord = Record<'a' | 'b' | 'c', number>;
// = { a: number; b: number; c: number } — exhaustivo
```

### `PropertyKey` y `object` built-in

Dos tipos que Matt presenta y rara vez usarás:

```ts
type AnyKey = PropertyKey;   // = string | number | symbol
type AnyObject = object;     // cualquier non-primitive, incluyendo arrays
```

`PropertyKey` aparece en utility types (`Record<PropertyKey, T>` para "cualquier objeto"). `object` es **demasiado amplio** para casi cualquier uso real — incluye arrays, functions, instances. Prefiere `Record<string, unknown>` cuando quieres "un objeto con properties string-keyed".

### Utility types: `Partial`, `Required`, `Pick`, `Omit`

```ts
type User = { id: string; email: string; name: string };

type UserUpdate = Partial<User>;
// = { id?: string; email?: string; name?: string }

type RequiredUser = Required<UserUpdate>;
// = { id: string; email: string; name: string }

type UserPublic = Pick<User, 'id' | 'email'>;
// = { id: string; email: string }

type UserNoId = Omit<User, 'id'>;
// = { email: string; name: string }
```

Importante de Matt:

- **`Omit` es "permisivo"**: `Omit<User, 'notAField'>` **no protesta**. Devuelve el tipo completo. Es un gotcha — esperarías un error, no lo hay.
- **Distributive sobre uniones**: `Pick<A | B, K>` se distribuye sobre los miembros del union, lo que a veces sorprende. Hay variantes "non-distributive" (`StrictPick`) en libs como `type-fest`.

Estos detalles los cubrimos en el [doc 21](../effectivetypescript/21-template-literal-y-mapped-types.md) y [doc 25](../effectivetypescript/25-index-signatures-y-record.md).

## Cómo se compara con nuestro track

| Tema                              | Nuestro doc                          |
|-----------------------------------|--------------------------------------|
| Intersection vs interface extends | [23 — Declaration merging](../effectivetypescript/23-declaration-merging.md) (parcial) |
| Index signatures y `Record`        | [25 — Index signatures y `Record`](../effectivetypescript/25-index-signatures-y-record.md) |
| Utility types (`Partial`, etc.)   | [21 — Template literal y mapped types](../effectivetypescript/21-template-literal-y-mapped-types.md) |
| Branded objects                   | [06 — Branded types](../effectivetypescript/06-branded-types.md) |

## Ideas que merecen anotarse

### `interface extends` puede heredar de múltiples

```ts
interface Persistable { save(): Promise<void> }
interface Timestamped { createdAt: Date; updatedAt: Date }

interface UserEntity extends Persistable, Timestamped {
  id: string;
  email: string;
}
```

Útil para composición vía "traits". Lo equivalente con intersection:

```ts
type UserEntity = Persistable & Timestamped & { id: string; email: string };
```

Las dos formas funcionan; `interface extends` tiende a ser más legible para herencia explícita.

### `Pick` y `Omit` no son estrictos por defecto

```ts
type User = { id: string; email: string };
type X = Omit<User, 'name'>;   // = User completo — no protesta de 'name' inexistente
```

Si te importa la safety, usa una versión strict:

```ts
type StrictOmit<T, K extends keyof T> = Omit<T, K>;
type X = StrictOmit<User, 'name'>;   // ❌ 'name' is not assignable to keyof User
```

Es trivial declararlo. La razón histórica de que `Omit` original no sea strict es backwards compat — cuando se introdujo, los users hacían `Omit<T, string>` y esperaban que funcionara.

### `Record<string, unknown>` ≠ `{}`

Matt subraya esto: `{}` significa "cualquier non-null/undefined value" (incluyendo primitives). `Record<string, unknown>` significa "un object con keys string". Para "objeto genérico", el segundo es lo correcto.

```ts
const a: {} = "hello";          // ✅ — sorprendente pero válido
const b: Record<string, unknown> = "hello";  // ❌ — no es un object
```

## Ejercicio

1. **Refactor a `interface extends`**: en `services/spring-api/` (si lo tienes), las entities Java tienen mucha herencia. ¿En la versión TS equivalente, usarías intersection o `interface extends`? Implementa los dos y compara.

2. **`StrictOmit` helper**: añade `type StrictOmit<T, K extends keyof T> = Omit<T, K>` a `services/node-api/src/lib/` y úsalo en todos los sitios donde tengas `Omit`. ¿Sale algún error que Omit ignoraba?

3. **`Pick` para `UserPublic`**: en `services/node-api/src/domain/user.ts`, define `type UserPublic = Pick<User, 'id' | 'email' | 'name'>` (excluye campos sensibles si los hubiera). Úsalo en el response del controller.

4. **`Partial<User>` para PATCH**: define un endpoint hipotético `PATCH /users/:id` que acepte `Partial<Omit<User, 'id' | 'createdAt'>>`. Confirma que el typecheck rechaza intentos de modificar `id`.

5. **Reto — `Record<string, unknown>` o índice vs `Pick` exhaustivo**: cuando modelas un payload incierto (ej. webhook handler), ¿`Record<string, unknown>` o `unknown` puro + validate? Discute con un compañero los trade-offs.

## 📖 Otros recursos

- [TypeScript Handbook — Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html) — referencia oficial.
- [TypeScript Handbook — Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html) — `Partial`, `Required`, `Pick`, `Omit`, `Record`, etc.
- [type-fest](https://github.com/sindresorhus/type-fest) — librería con variantes strict de los utility types y muchos otros tipos avanzados.

---

**Anterior:** [05 — Unions, Literals, and Narrowing](./05-unions-literals-narrowing.md)
**Siguiente:** [07 — Mutability](./07-mutability.md)
