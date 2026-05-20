# 15 — Designing Your Types

> 📖 Capítulo original: [Designing Your Types in TypeScript](https://www.totaltypescript.com/books/total-typescript-essentials/designing-your-types-in-typescript)

## Qué cubre Matt

A pesar del título, **este capítulo no trata de API design** (eso es nuestro [doc 27](../effectivetypescript/27-api-design-y-evolucion.md)). Trata del **toolkit type-level**: las herramientas para crear tipos sofisticados a partir de otros tipos:

1. **Generic types** — type functions con parámetros, defaults, constraints.
2. **Template literal types** — patrones de strings a nivel de tipo.
3. **Conditional types** — if/else en el sistema de tipos.
4. **Mapped types** — iterar sobre keys para derivar tipos.

Es el **toolkit avanzado de TS** — material que ocupa varios docs en nuestro track.

## Lo que importa

### Generic types — type functions

```ts
type Box<T> = { value: T };
type StringBox = Box<string>;   // { value: string }

type Pair<A, B> = { first: A; second: B };

// Default
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Constraint
type WithId<T extends { id: string }> = T;
type ValidUser = WithId<{ id: '1', name: 'Jose' }>;   // ✅
type InvalidUser = WithId<{ name: 'Jose' }>;            // ❌ — falta id
```

**Defaults** (cubierto en [doc 19](../effectivetypescript/19-generics-avanzados.md)): añadir un parámetro genérico con default es non-breaking. `Result<User>` sigue funcionando si añades `E = Error`.

**Constraints** (`T extends ...`): restringes qué tipos son válidos. Sin constraint, `T` es `unknown` — no puedes hacer nada con él dentro del genérico salvo pasarlo.

### Template literal types

```ts
type Greeting = `hello, ${string}`;

const a: Greeting = 'hello, world';      // ✅
const b: Greeting = 'goodbye, world';     // ❌

// Con uniones — producto cartesiano
type Size = 'sm' | 'md' | 'lg';
type Color = 'red' | 'blue';
type Class = `${Size}-${Color}`;
// = 'sm-red' | 'sm-blue' | 'md-red' | ... (6 combos)

// Built-in transformers
type T1 = Uppercase<'foo'>;     // 'FOO'
type T2 = Capitalize<'foo'>;    // 'Foo'
type T3 = Lowercase<'BAR'>;     // 'bar'
type T4 = Uncapitalize<'Bar'>;  // 'bar'
```

Cubierto a fondo en [doc 21 — Template literal y mapped types](../effectivetypescript/21-template-literal-y-mapped-types.md).

### Conditional types — `T extends U ? X : Y`

```ts
type IsString<T> = T extends string ? true : false;

type A = IsString<'hello'>;     // true
type B = IsString<42>;           // false
type C = IsString<string>;       // true
type D = IsString<unknown>;      // false (unknown no es string)
```

Bajo el capó, los utility types `Exclude`, `Extract`, `NonNullable`, `Awaited`, `ReturnType`, `Parameters` son conditional types con `infer`. Cubierto en [doc 20](../effectivetypescript/20-conditional-types-e-infer.md).

### Mapped types — iterar sobre keys

```ts
type User = { id: string; name: string; email: string };

type Optional<T> = { [K in keyof T]?: T[K] };
type OptionalUser = Optional<User>;
// = { id?: string; name?: string; email?: string }

// Con renaming (`as`)
type Getters<T> = {
  [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K]
};
type UserGetters = Getters<User>;
// = { getId: () => string; getName: () => string; getEmail: () => string }
```

Cubierto en [doc 21](../effectivetypescript/21-template-literal-y-mapped-types.md).

## Cómo se compara con nuestro track

Este capítulo es **denso pero introductorio**. Cubre los cuatro pilares del type-level en general, sin profundizar demasiado en ninguno. Nuestros docs sí entran profundo:

| Tema                                  | Nuestro doc                                         |
|---------------------------------------|------------------------------------------------------|
| Generics avanzados                    | [19 — Generics avanzados](../effectivetypescript/19-generics-avanzados.md) |
| Conditional types + `infer`            | [20 — Conditional types e `infer`](../effectivetypescript/20-conditional-types-e-infer.md) |
| Template literal + mapped types       | [21 — Template literal y mapped types](../effectivetypescript/21-template-literal-y-mapped-types.md) |
| API design (lo que el TÍTULO promete)  | [27 — API design y evolución](../effectivetypescript/27-api-design-y-evolucion.md) |

**Recomendación**: lee el capítulo de Matt para tener una "vista de pájaro" cohesiva del toolkit. Cuando necesites profundidad, pásate a nuestros docs.

## Ideas que merecen anotarse

### Generics como "type functions"

Matt usa esta analogía a fondo: un genérico es **una función que toma tipos y devuelve un tipo**. La sintaxis ayuda a verlo:

```ts
// JS function value-level
function box(value: any) { return { value }; }
const b = box(42);   // { value: 42 }

// TS type "function" type-level
type Box<T> = { value: T };
type B = Box<42>;     // { value: 42 }
```

`T` es el "parámetro". El cuerpo es la "expresión". El "resultado" es el tipo computado. Esta mental model facilita pensar en generics complejos.

### Distributive conditional types

Mencionado al pasar pero crítico:

```ts
type ToArray<T> = T extends any ? T[] : never;

type A = ToArray<string | number>;
// = string[] | number[]   ← se distribuyó sobre la unión
```

Cuando `T` es un **type parameter "naked"** en la posición izquierda del `extends`, TS distribuye sobre uniones. Para suprimir:

```ts
type ToArrayNonDistrib<T> = [T] extends [any] ? T[] : never;
type B = ToArrayNonDistrib<string | number>;
// = (string | number)[]
```

Esto cuesta cazarlo si no lo conoces. Cubierto en [doc 20](../effectivetypescript/20-conditional-types-e-infer.md).

### Mapped types preservan modifiers

```ts
type User = { readonly id: string; name?: string };
type Mapped = { [K in keyof User]: User[K] };
// = { readonly id: string; name?: string }   ← preserva readonly y ?
```

Para modificar:

```ts
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Required<T> = { [K in keyof T]-?: T[K] };
```

El `-` quita el modifier. Combinado, control total sobre `readonly` y `?`.

## Ejercicio

1. **Construye `DeepPartial<T>`**: aplica `Partial` recursivamente. Pista: combina mapped type + conditional.

2. **Template literal para rutas HTTP**: define `type Route = \`${HttpMethod} /${string}\`` y úsalo en una firma `register(route: Route, handler: Handler)`. Confirma que `register('GETs /foo')` falla y `register('GET /foo')` pasa.

3. **Mapped type con `as` para getters**: implementa `Getters<T>` del ejemplo. Aplícalo a `User` del repo. ¿Cómo encaja con clases (cap. 8)?

4. **Distributive condicional vs no-distributivo**: implementa `IsExactlyString<T>` que distinga `string` de `string | number`. Pista: usa `[T] extends [string]` para evitar la distribución.

5. **Reto — type-level testing**: usando [doc 14](../effectivetypescript/14-type-level-testing.md), añade tests que verifiquen `Partial<User>['id']` es `string | undefined`, no `string`.

## 📖 Otros recursos

- [TypeScript Handbook — Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [TypeScript Handbook — Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [TypeScript Handbook — Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [type-challenges](https://github.com/type-challenges/type-challenges) — ejercicios type-level puros, sin runtime.

---

**Anterior:** [14 — Configuring TypeScript](./14-configuring-typescript.md)
**Siguiente:** [16 — Utility Folder Development](./16-utility-folder-development.md)
