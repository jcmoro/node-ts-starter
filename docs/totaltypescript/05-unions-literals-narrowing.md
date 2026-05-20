# 05 — Unions, Literals, and Narrowing

> 📖 Capítulo original: [Unions, Literals, and Narrowing](https://www.totaltypescript.com/books/total-typescript-essentials/unions-literals-and-narrowing)

## Qué cubre Matt

Uno de los capítulos más ricos del libro. Cubre las **tres herramientas centrales** de tipos de TS para modelar "esto puede ser una de varias cosas":

1. **Unions** (`A | B`) — el OR a nivel de tipos.
2. **Literal types** (`'success' | 'error'`) — tipos restringidos a valores concretos.
3. **Narrowing** — cómo TS estrecha un union en función del código.

Y dos tipos especiales del extremo de la jerarquía:

4. **`unknown`** — el top type, "podría ser cualquier cosa, pruébalo antes de usarlo".
5. **`never`** — el bottom type, "esto no puede ocurrir".

Cierra con **discriminated unions**, el patrón que combina los puntos anteriores en algo robusto y muy presente en código TS senior.

## Lo más importante

### Wider vs narrower — la jerarquía de tipos

```
unknown    ← lo más amplio, "podría ser cualquier cosa"
  └─ string | number
       └─ string
            └─ 'success' | 'error'   ← literal types
                 └─ 'success'
                      └─ never        ← lo más estrecho, "imposible"
```

**Asignabilidad fluye de estrecho a amplio**: un `'success'` es asignable a `'success' | 'error'`, que es asignable a `string`. Al revés no funciona sin narrow.

### Narrowing: cuatro técnicas

Cubiertas a fondo en nuestro [doc 18](../effectivetypescript/18-narrowing-y-type-guards.md). Matt las nombra similar:

| Técnica          | Sintaxis típica                        | Para qué                            |
|------------------|----------------------------------------|--------------------------------------|
| `typeof`         | `if (typeof x === 'string')`            | Primitivos (`string`, `number`, etc.) |
| `instanceof`     | `if (e instanceof Error)`                | Clases                                |
| `in`             | `if ('meow' in animal)`                  | Detectar properties en uniones de objects |
| Discriminante    | `if (r.ok)` sobre un sealed union       | El más limpio                         |

### Discriminated unions vs "bag of optionals"

Matt nombra al anti-patrón directamente: **"bag of optionals"** es el modelo que se ve mucho en código JS migrado a TS:

```ts
// ❌ Bag of optionals
type Result<T> = {
  ok: boolean;
  value?: T;
  error?: Error;
};
```

Problemas:
- `{ ok: true }` (sin value) compila aunque no tenga sentido.
- `{ ok: false, value: x, error: e }` también compila.
- El IDE no narrow sobre `r.value` cuando `r.ok === true`.

```ts
// ✅ Discriminated union
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

- `{ ok: true }` no compila (falta `value`).
- `{ ok: false, value: x }` no compila (excess property).
- `if (r.ok)` narrow correctamente.

### `unknown` vs `any`

```ts
const a: any = JSON.parse(input);
a.foo.bar();                   // ✅ compila — runtime crashea si .foo no existe

const u: unknown = JSON.parse(input);
u.foo.bar();                    // ❌ Object is of type 'unknown' — debes narrow primero
```

**`unknown` es el "any seguro"**. Es lo que querías que `any` fuera.

### `never` en switch exhaustivos

Patrón canónico de exhaustiveness check (cubierto a fondo en [doc 18](../effectivetypescript/18-narrowing-y-type-guards.md)):

```ts
type Color = 'red' | 'green' | 'blue';

function describe(c: Color): string {
  switch (c) {
    case 'red':   return 'fire';
    case 'green': return 'grass';
    case 'blue':  return 'sky';
    default:
      const _exhaustive: never = c;
      throw new Error(`Unreachable: ${_exhaustive}`);
  }
}
```

Si añades `'yellow'` a `Color` sin actualizar el switch, **el `: never = c` no compila** porque `c` es `'yellow'` no `never`. El compilador te avisa antes de ejecutarse.

## Cómo se compara con nuestro track

Este capítulo solapa con dos de los nuestros más densos:

- [Doc 04 — Result type](../effectivetypescript/04-result-type.md): discriminated unions aplicadas al patrón Result, con el porqué (excepciones vs control flow esperado).
- [Doc 18 — Narrowing y type guards](../effectivetypescript/18-narrowing-y-type-guards.md): las cuatro vías de narrowing, type predicates, `assertNever`, `unknown` vs `any` vs `never` en profundidad.

Si el capítulo de Matt te sabe a poco, nuestros dos docs lo amplían 3-4x con más casos y trampas.

## Ideas que merecen anotarse

### "Unions son más amplias que sus miembros"

Frase de Matt que vale la pena memorizar:

> A union `A | B` is **wider** than either `A` or `B` alone.

Implicación práctica: si una función firma como `f(x: A | B)`, **puedes pasarle un `A`**, un `B`, o cualquier valor que sea de uno de los dos. Si firma `f(x: A)`, solo `A`. Es decir, **una unión es más permisiva en entrada y menos garantizadora en salida**.

Recuerda el principio de Postel del [doc 27](../effectivetypescript/27-api-design-y-evolucion.md): "be liberal in what you accept, conservative in what you produce". Unions amplias en input = permisivo. Unions estrechas en output = garantizador.

### Literal types como machine-state enums

Un patrón que merece más visibilidad:

```ts
type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User }
  | { status: 'error'; error: Error };
```

Cada estado tiene **exactamente** las properties que tienen sentido. `data` solo existe en `'success'`. `error` solo en `'error'`. El compilador lo aplica.

Compáralo con el típico `{ isLoading, data, error }` con tres opcionales — el "bag of optionals" otra vez.

### Excess property checks

```ts
type Pet = { name: string };
const p: Pet = { name: 'Rex', age: 5 };   // ❌ 'age' does not exist
```

TS aplica **excess property checks** SOLO en literal-to-type assignment direct. Si pasas por variable, la check no se aplica:

```ts
const data = { name: 'Rex', age: 5 };
const p: Pet = data;                        // ✅ pasa (structural)
```

Matt lo cubre brevemente; nosotros lo mencionamos como trampa en [doc 27](../effectivetypescript/27-api-design-y-evolucion.md).

## Ejercicio

1. **Refactor de un "bag of optionals"**: busca en `services/node-api/src/` algún tipo con varias properties opcionales que en realidad son estados mutuamente excluyentes. Refactoriza a discriminated union. Confirma que los callers se simplifican.

2. **`assertNever` en práctica**: si has hecho los ejercicios del [doc 18](../effectivetypescript/18-narrowing-y-type-guards.md), ya tienes uno. Si no, añade un `function assertNever(x: never): never { throw ... }` en `services/node-api/src/lib/` y úsalo en algún switch sobre `User['role']` o similar.

3. **`unknown` desde `JSON.parse`**: hay quien tipa `JSON.parse(input)` como `any` (su firma default). Cubre `JSON.parse` con un helper que devuelva `unknown` y narrow con Zod antes de usar el valor. Es exactamente lo que hace nuestro `parsed = CreateUserSchema.safeParse(JSON.parse(body))` en `app.ts`.

4. **Reto — finite state machine tipada**: modela un FSM de pedidos con literals: `'pending' → 'confirmed' → 'shipped' → 'delivered'`, con transiciones explícitas. Una función `transition(state: OrderState, event: Event): OrderState` solo permite combinaciones válidas. Es type-state programming (cubierto en [doc 27](../effectivetypescript/27-api-design-y-evolucion.md)).

## 📖 Otros recursos

- [TypeScript Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — referencia oficial.
- [Matt Pocock — "Discriminated Unions: TypeScript's most useful pattern"](https://www.totaltypescript.com/discriminated-unions-are-a-language-feature) — artículo independiente del autor.
- [Effective TypeScript — Item 28: Prefer Types That Always Represent Valid States](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/valid-states.md) — el mismo principio enunciado como regla.

---

**Anterior:** [04 — Essential Types and Annotations](./04-essential-types.md)
**Siguiente:** [06 — Objects](./06-objects.md)
