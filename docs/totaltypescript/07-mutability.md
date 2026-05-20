# 07 — Mutability

> 📖 Capítulo original: [Mutability](https://www.totaltypescript.com/books/total-typescript-essentials/mutability)

## Qué cubre Matt

Dos bloques:

1. **Mutability afecta la inferencia**: `let` ensancha, `const` estrecha, properties de objects son siempre wide aunque el binding sea `const`.
2. **Inmutabilidad explícita**: `readonly`, `Readonly<T>`, `ReadonlyArray<T>`, `as const`, y comparación con `Object.freeze`.

Es el complemento natural del cap. 6 (Objects) y se solapa con [nuestro doc 06 ampliado](../effectivetypescript/06-branded-types.md) (sección "Composición con `as const` y `readonly`").

## Lo más relevante

### Inferencia: `let` ensancha, `const` estrecha

```ts
let x = 'hello';      // inferred: string
const y = 'hello';    // inferred: 'hello' (literal type)

const arr = [1, 2, 3];   // inferred: number[]  ← NO [1, 2, 3]!
```

**¿Por qué `const` no salva el array?** Porque el binding es immutable pero **el contenido del array no lo es**. TS infiere lo más amplio (`number[]`) porque `arr.push(99)` sigue funcionando. Para estrechar a la tuple literal, necesitas `as const` explícito:

```ts
const arr = [1, 2, 3] as const;   // inferred: readonly [1, 2, 3]
```

Misma cosa con objects:

```ts
const point = { x: 1, y: 2 };           // inferred: { x: number; y: number }
const pointConst = { x: 1, y: 2 } as const;  // inferred: { readonly x: 1; readonly y: 2 }
```

### `readonly` shallow vs deep

```ts
type ShallowReadonly = Readonly<{
  name: string;
  address: { street: string };
}>;
// = {
//     readonly name: string;
//     readonly address: { street: string };   ← address es readonly, su contenido NO
//   }

const u: ShallowReadonly = { ... };
u.name = 'x';            // ❌
u.address = { ... };     // ❌
u.address.street = 'x';  // ✅ — su contenido es mutable
```

`Readonly<T>` y `readonly` son **shallow**. Para profundidad, escribes `DeepReadonly<T>` a mano (cubierto en el [doc 21](../effectivetypescript/21-template-literal-y-mapped-types.md)) o usas `as const` sobre literales (que sí es deep).

### `ReadonlyArray<T>` vs `T[]`

```ts
function logAll(items: ReadonlyArray<string>) {
  items.forEach(...);            // ✅
  items.push('x');               // ❌
  items.map(x => x.toUpperCase());  // ✅ (devuelve nuevo array)
}

// Compatibilidad:
const mutable: string[] = ['a'];
logAll(mutable);                  // ✅ — mutable es asignable a readonly
const readonly: readonly string[] = ['a'];
takesMutable(readonly);           // ❌ — readonly NO es asignable a mutable
```

**Recomendación de Matt y nuestra**: usa `readonly` por defecto en parámetros y returns. Solo levanta a mutable cuando realmente necesitas mutar.

### `as const` vs `Object.freeze`

```ts
const a = { x: 1 } as const;       // type-level inmutable, runtime mutable
const b = Object.freeze({ x: 1 }); // runtime inmutable (shallow), type wide

a.x = 2;   // ❌ TS error
b.x = 2;   // ❌ TypeError en runtime (strict mode) o silent fail
```

| Característica         | `as const`              | `Object.freeze`           |
|------------------------|-------------------------|----------------------------|
| Tipo inferido          | Literal estrechado     | Original (no afecta tipos) |
| Profundidad            | Deep                    | Shallow                    |
| Bloqueo runtime        | No (solo compile-time)  | Sí                         |
| Lectura por IDE        | Literal type            | Tipo original              |

Por defecto querrás `as const` para máxima información en tipos. `Object.freeze` solo si necesitas la protección runtime también (raramente — añade overhead y los devs senior no mutan lo que no toca).

## Cómo se compara con nuestro track

[Doc 06 — Branded types](../effectivetypescript/06-branded-types.md) tiene una sección "Composición con `as const` y `readonly`" que cubre:

- `as const` para extraer uniones de literales desde arrays.
- `readonly` arrays como contrato de API.
- Composición con branded types.

Ese material extiende el capítulo de Matt con casos prácticos.

## Ideas que merecen anotarse

### "`const` is about bindings, not values"

```ts
const arr = [1, 2, 3];
arr.push(4);    // ✅ — no estás reasignando arr, lo mutas
arr = [];       // ❌ — reasignación del binding
```

JS tiene `const` para bindings. TS le añade `readonly` para values. Son cosas distintas.

### `as const` no es solo para constants — útil en function returns

```ts
function getStatus() {
  return { kind: 'success', code: 200 } as const;
}
// inferred: { readonly kind: 'success'; readonly code: 200 }

// Sin as const:
// inferred: { kind: string; code: number }
```

El segundo es menos útil — `'success'` como literal te permite hacer narrow en el caller. `string` se pierde como info.

### `Object.freeze` es un anti-patrón en TS moderno

A menos que tengas un caso específico donde necesites bloqueo runtime (e.g., librería pública que entrega un objeto a unsanitized callers), **usa `as const` y readonly types**. Object.freeze:

- Es shallow.
- Añade overhead de invocation.
- No comunica al type checker.
- Romperá silently con `delete obj.x` en modo non-strict.

## Ejercicio

1. **Refactor de `const arr = [1,2,3]` a `as const`**: busca en `services/node-api/src/` algún array con valores conocidos (lista de roles, estados, configs). Aplica `as const`. ¿Cambia algún uso downstream? ¿Te beneficia la inferencia literal?

2. **`readonly` en API pública**: cambia el return type de algún método del `UserService` que devuelva una colección, de `User[]` a `readonly User[]`. ¿Cuántos callers tienen que adaptarse? ¿Por qué cambiaste — qué garantía ganas?

3. **`DeepReadonly` propio**: si haces el ejercicio del [doc 21](../effectivetypescript/21-template-literal-y-mapped-types.md), implementa `DeepReadonly<T>` recursivo. Aplícalo a `User` con sub-objects. Compáralo con `Readonly<User>`.

4. **`as const` extracción de uniones**:
   ```ts
   const ROLES = ['admin', 'user', 'guest'] as const;
   type Role = typeof ROLES[number];   // 'admin' | 'user' | 'guest'
   ```
   Aplica este patrón en `services/node-api/src/domain/user.ts` para los enums (si tienes alguno). Compara con `enum` nativo de TS.

5. **Reto — `Object.freeze` runtime test**: crea un objeto con `Object.freeze`. Verifica con `Object.isFrozen()`. Intenta mutarlo en non-strict y strict mode. ¿Qué pasa con `delete obj.x`? Es el por qué Matt recomienda `as const` salvo casos puntuales.

## 📖 Otros recursos

- [TypeScript Handbook — Readonly](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties) — referencia oficial.
- [Effective TypeScript — Item 14: Use `readonly` to Avoid Errors Associated with Mutation](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/readonly.md) — la regla unificada.
- [MDN — Object.freeze](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze) — el comportamiento runtime con detalle.

---

**Anterior:** [06 — Objects](./06-objects.md)
**Siguiente:** [08 — Classes](./08-classes.md)
