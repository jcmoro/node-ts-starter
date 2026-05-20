# 11 — Annotations and Assertions

> 📖 Capítulo original: [Annotations and Assertions](https://www.totaltypescript.com/books/total-typescript-essentials/annotations-and-assertions)

## Qué cubre Matt

Las cuatro formas de **forzar tu opinión sobre el inferencer**:

1. **Annotations** (`: Type`) — declarar el tipo de una variable.
2. **`satisfies`** — validar contra un tipo sin perder la inferencia específica.
3. **`as` assertions** — castear (peligroso si mientes).
4. **Error suppression directives** — `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`.

## Lo más relevante

### Annotation vs inference vs `satisfies` — los tres modos

```ts
type Color = 'red' | 'green' | 'blue';

// 1. Annotation — el tipo gana, la inferencia se pierde
const a: Color = 'red';
a.length;   // ❌ porque a: Color, no se sabe que es exactamente 'red'

// 2. Sin annotation — el valor gana, no se valida shape
const b = 'red';
b.length;   // ✅ — b: 'red' literal, accesible
// pero: const c = 'purple' — ✅ TS lo acepta aunque no sea Color

// 3. satisfies — valida + preserva
const c = 'red' satisfies Color;
c.length;   // ✅ — c sigue siendo 'red' literal
const d = 'purple' satisfies Color;   // ❌ — no satisface Color
```

**`satisfies`** es lo mejor de ambos mundos: la validación de annotation con la precisión de la inferencia.

### Cuándo `satisfies` brilla — config objects

```ts
// Sin satisfies
const config = {
  api: 'http://localhost:3000',
  port: 3000,
} as Record<string, string | number>;
config.api.toUpperCase();   // ❌ — port podría ser number, no string

// Con satisfies
const config = {
  api: 'http://localhost:3000',
  port: 3000,
} satisfies Record<string, string | number>;
config.api.toUpperCase();   // ✅ — api: string literal, preserved
```

Cubierto a fondo en [nuestro doc 22 — Overloads y `satisfies`](../effectivetypescript/22-overloads-y-satisfies.md).

### `as` assertions — la herramienta peligrosa

```ts
const value: unknown = JSON.parse(input);
const user = value as User;   // ⚠️ — promesa al compilador, sin validation
user.email.toUpperCase();      // TS confía. En runtime, posible TypeError.
```

`as` **no valida**, **no narrowea correctamente**, **no es seguro**. Es decir "TS, confía en mí". Si mientes, TS te cree y todo lo aguas abajo se contamina.

**Salvaguarda incorporada**: TS rechaza `as` entre tipos no relacionados estructuralmente:

```ts
const x: number = 42;
const y = x as string;            // ❌ — number y string no se solapan
const y = x as unknown as string; // ✅ — el "double cast" lo permite (mala señal!)
```

El "double cast via `unknown`" es la marca canónica de "estoy haciendo algo que TS desaprueba". Si lo escribes, **párate y revisa**.

### `!` non-null assertion

```ts
function find(id: string): User | null { ... }

const user = find('1')!;   // afirma que no es null
user.email;                 // ✅ TS lo acepta, en runtime puede crashear
```

Útil cuando **sabes** que la cosa existe pero TS no lo deduce. **Peligroso** si tu garantía falla. Prefiere narrowing explícito:

```ts
const user = find('1');
if (!user) throw new UserNotFoundError(id);
user.email;   // ✅ narrow correcto
```

### `@ts-expect-error` vs `@ts-ignore`

```ts
// @ts-expect-error — espera que haya error. Si no lo hay, protesta.
// @ts-ignore — suprime cualquier error. Si no hay error, queda silente.
```

**Siempre prefiere `@ts-expect-error`**. Es self-cleaning: cuando arreglas el problema, el `@ts-expect-error` protesta porque ya no hay error que esperar. `@ts-ignore` queda como deuda silenciosa.

### `@ts-nocheck` — el último recurso

Desactiva el type checker para **todo el archivo**. Útil solo para:

- Archivos JS migrando a TS gradualmente.
- Archivos generados (que no controlas).
- Snapshot de migración temporal.

Si lo encuentras en código de producción, hay deuda.

## Cómo se compara con nuestro track

[Doc 22 — Overloads y `satisfies`](../effectivetypescript/22-overloads-y-satisfies.md) cubre `satisfies` a fondo con ejemplos prácticos. `as` y los directives aparecen como trampas en varios docs (especialmente 06 — branded types, donde la única `as` legítima vive dentro del schema constructor).

## Ideas que merecen anotarse

### "Annotation makes the variable the source of truth. Inference makes the value the source of truth."

Reformulación útil. Cuando dudes:

- **Public API** (function signatures, exported types) → annotation (variable gana).
- **Internal values** (config, lookup tables) → inference o `satisfies` (valor gana).

### `as const` vs `as Type`

```ts
const x = 'red' as const;    // x: 'red' (literal, deep readonly)
const x = 'red' as Color;     // x: Color (widened to the union)
```

Son **opuestos**:
- `as const` estrecha (literal type).
- `as Type` ensancha o castea.

Casualmente comparten la palabra `as`. Confunde al principio.

### `as` legítimo: dentro de smart constructors

```ts
function makeEmail(raw: string): Email | null {
  if (!validEmail(raw)) return null;
  return raw as Email;   // ✅ legítimo — validamos antes del cast
}
```

El cast **inside** un validator. Encapsulado. Es exactamente el patrón del [doc 06](../effectivetypescript/06-branded-types.md).

### "Don't use `as` to silence errors"

```ts
// ❌ Anti-patrón clásico
const config = readJsonFile('config.json') as Config;
// Mejor:
const config = ConfigSchema.parse(readJsonFile('config.json'));
```

`as` para "callar el compilador" es deuda técnica. Validate con Zod / io-ts / valibot. Cuesta 3 líneas, paga en safety runtime.

## Ejercicio

1. **Audit de `as` en el repo**: `grep "as " services/node-api/src/` y revisa cada match. ¿Cuáles son legítimos (dentro de smart constructors, comparing literals)? ¿Cuáles son deuda? Refactoriza los segundos.

2. **`satisfies` sobre un Record**: en `services/node-api/src/`, busca algún `Record<string, T>` declarado a la fuerza. Refactoriza a `as const satisfies Record<string, T>`. ¿Cambia algo en el comportamiento? ¿En el IDE?

3. **`@ts-expect-error` en un test**: añade un test type-level (doc 14) que verifique que un tipo incorrecto **no se asigna**. Usa `@ts-expect-error` antes de la línea esperada-rota. Confirma que al arreglar el tipo, el `@ts-expect-error` protesta porque ya no hay error.

4. **`!` non-null vs narrowing explícito**: encuentra un `obj!.field` en el repo. Refactoriza a narrowing explícito con if-throw. Compara legibilidad.

5. **Reto — eliminar `@ts-ignore`**: si tienes algún `@ts-ignore` en el repo, sustitúyelo por `@ts-expect-error` y luego arregla la raíz. Confirma que el `@ts-expect-error` ya no es necesario.

## 📖 Otros recursos

- [TypeScript Handbook — `satisfies` Operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator) — release notes donde se introdujo (TS 4.9).
- [Matt Pocock — "satisfies is incredible"](https://www.youtube.com/results?search_query=matt+pocock+satisfies) — varios shorts.
- [Effective TypeScript — Item 9: Prefer Type Declarations to Type Assertions](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/declare-not-assert.md) — la regla matriz.

---

**Anterior:** [10 — Deriving Types](./10-deriving-types.md)
**Siguiente:** [12 — The Weird Parts](./12-the-weird-parts.md)
