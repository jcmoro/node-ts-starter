# 14 — Type-level testing

## El problema

Los tests del capítulo 05 verifican **comportamiento en runtime**: el código devuelve `{ ok: true, value: 42 }`, los handlers responden 201, etc. Lo que **no verifican** es que el **tipo** de los valores sea el que prometes.

Ejemplo concreto:

```ts
// src/lib/result.ts
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
```

La firma promete `Result<T, never>`. ¿Y si mañana alguien refactoriza a:

```ts
export const ok = <T>(value: T): Result<T, Error> => ({ ok: true, value });
```

Los tests runtime **siguen pasando** — `ok(42)` sigue devolviendo `{ ok: true, value: 42 }` en runtime. Pero el contrato de tipos se rompió silenciosamente: ahora no puedes pasar un `ok(42)` a una función que espera `Result<number, NotFoundError>` (antes sí podías porque `never` es subtipo de todo).

La firma es **parte del API público** tanto como el comportamiento runtime. Necesitas tests para los dos.

## Lo que es un type-test

Un archivo `.ts` donde **el compilador es el assert**. La estructura:

```ts
type Expect<T extends true> = T;
type Equal<X, Y> = /* magic */;

type Tests = [
  Expect<Equal<ReturnType<typeof ok<number>>, Result<number, never>>>,
];
```

- Si `Equal<...>` se evalúa a `true`, `Expect<true>` compila, todo OK.
- Si se evalúa a `false`, `Expect<false>` no compila — tsc reporta `Type 'false' does not satisfy the constraint 'true'`.

**Sin assert library. Sin overhead runtime.** El archivo se compila y desaparece.

> 💡 **Comparación**: equivale a las "compile-time assertions" de Java con `@SuppressWarnings`, o a los traits + tests de Rust. En Go no hay equivalente nativo — usas `var _ Interface = (*Impl)(nil)` para forzar checks de subtipo, pero no llegas tan lejos.

## El truco `Equal<X, Y>` (Item 55 del libro)

La versión **ingenua** que parece obvia:

```ts
type EqualNaive<X, Y> = X extends Y ? (Y extends X ? true : false) : false;
```

Tiene varios bugs sutiles:

```ts
type Bad1 = EqualNaive<any, string>; // → boolean (¡!), no false
type Bad2 = EqualNaive<true, boolean>; // → true (incorrecto: true es subset)
```

`any` es asignable a todo y todo es asignable a `any`, así que pasa el check. Y la distribución sobre uniones devuelve `boolean` en lugar de `true | false` discreto.

La versión **canónica**:

```ts
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
    ? true
    : false;
```

**Por qué funciona**: TypeScript compara dos firmas genéricas **estructuralmente solo si los parámetros de tipo son idénticos en cada posición de evaluación**. La función `<T>() => T extends X ? 1 : 2` "atrapa" la identidad de X de una forma que `extends` solo no captura.

Resultado:

```ts
type Test1 = Equal<any, string>;     // false ✅
type Test2 = Equal<true, boolean>;   // false ✅
type Test3 = Equal<boolean, true | false>; // true ✅
```

Una **limitación conocida**: `Equal<any, unknown>` devuelve `true`. Si necesitas distinguirlos, usa `IsAny<T>` de [`type-fest`](https://github.com/sindresorhus/type-fest). Para casi todo lo demás, `Equal` basta.

## Los helpers del proyecto

`src/lib/type-test.ts`:

```ts
export type Expect<T extends true> = T;

export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;

export type NotEqual<X, Y> = Equal<X, Y> extends true ? false : true;

export type Extends<X, Y> = [X] extends [Y] ? true : false;
export type NotExtends<X, Y> = [X] extends [Y] ? false : true;
```

Notas senior:

- **`[X] extends [Y]`** en lugar de `X extends Y` para evitar la **distribución sobre uniones**. Si `X = string | number`, `X extends Y` distribuye y evalúa cada miembro por separado. El wrap en tuple `[X]` lo previene. Para tests de subtipo, casi siempre quieres esto.
- **No exporto `Expect<NotEqual<...>>` como un wrapper distinto**. `Expect<true>` es suficientemente general: cualquier predicado que devuelva `true | false` cabe dentro.

## Aplicación 1: `Result<T, E>` (cap. 04)

`src/lib/result.type-test.ts`:

```ts
import type { Result, err, ok, tryCatch } from './result.ts';
import type { Equal, Expect, Extends } from './type-test.ts';

export type Tests = [
  // ok<T>(value) devuelve Result<T, never>
  Expect<Equal<ReturnType<typeof ok<number>>, Result<number, never>>>,
  Expect<Equal<ReturnType<typeof ok<'literal'>>, Result<'literal', never>>>,

  // err<E>(error) devuelve Result<never, E>
  Expect<Equal<ReturnType<typeof err<Error>>, Result<never, Error>>>,

  // tryCatch siempre envuelve en Error (no unknown)
  Expect<Equal<ReturnType<typeof tryCatch<string>>, Promise<Result<string, Error>>>>,

  // Result<T> con un solo arg aplica E = Error por defecto
  Expect<Equal<Result<number>, Result<number, Error>>>,

  // Cada rama es subtipo del Result completo
  Expect<Extends<{ ok: true; value: number }, Result<number, never>>>,
  Expect<Extends<{ ok: false; error: Error }, Result<never, Error>>>,
];
```

**Qué protege esto contra**:

1. Cambiar `ok<T>(): Result<T, never>` a `Result<T, Error>` silenciosamente.
2. Renombrar la prop `value` a `data`.
3. Cambiar el default de `E` de `Error` a `unknown`.

Cualquiera de esos refactors **rompe tsc** y CI te avisa. Los tests runtime ni se entera.

## Aplicación 2: Branded types (cap. 06)

`src/domain/user.type-test.ts`:

```ts
export type Tests = [
  // El whole point del brand: distinguibles a nivel de tipo
  Expect<NotEqual<Email, string>>,
  Expect<NotEqual<UserId, string>>,
  Expect<NotEqual<Email, UserId>>,

  // Email ES un string (subtipo)
  Expect<Extends<Email, string>>,

  // string NO es un Email (la dirección que protege)
  Expect<NotExtends<string, Email>>,

  // Single source of truth: schema y tipo están alineados
  Expect<Equal<z.infer<typeof EmailSchema>, Email>>,
  Expect<Equal<z.infer<typeof UserSchema>, User>>,
];
```

Estos tests son **el contrato del Item 64 del libro**:

- *"Brands must produce types that are not assignable from their base."*

Una assertion específica: `Expect<NotExtends<string, Email>>`. Si alguien quita el `.brand<'Email'>()` del schema por accidente, `Email` se convierte en `string` plano, **`string` pasa a ser asignable a `Email`**, y este test falla. Sin él, el bug pasa sin avisar.

## Integración con el build

Los archivos `.type-test.ts` viven en `src/`, son **archivos TS normales**. Eso significa:

- **`tsc --noEmit` los compila** → `make typecheck` ya los corre. No hay target nuevo.
- **`node --test 'src/**/*.test.ts'` los ignora** (sufijo distinto) → no contaminan los tests runtime.
- **`make check` los cubre** porque incluye typecheck.

```bash
make check
# lint ✓ typecheck ✓ (incluye type-tests) ✓ tests ✓
```

**Trampa**: si un type-test escapa de tsc (e.g., si `skipLibCheck` lo afecta o si está fuera del `include` del tsconfig), pasa silenciosamente. Asegúrate de que `src/**/*.type-test.ts` está dentro del include — en nuestro `tsconfig.json` ya lo está.

### Verificación destructiva

Para confirmar que el sistema funciona, **rompe a propósito** una assertion y mira el error:

```bash
# En src/lib/result.type-test.ts, cambia:
#   Result<number, never>  →  Result<string, never>
npm run typecheck
# src/lib/result.type-test.ts(7,10): error TS2344:
#   Type 'false' does not satisfy the constraint 'true'.
```

Restaura. Esa es exactamente la señal que CI verá si tu PR rompe un contrato de tipos.

## Alternativas con API runtime-style

### `expect-type` (recomendado para proyectos grandes)

[`expect-type`](https://github.com/mmkal/expect-type) (~50KB, zero runtime overhead — los calls evalúan a no-ops):

```ts
import { expectTypeOf } from 'expect-type';
import { ok, type Result } from './result.ts';

expectTypeOf(ok(42)).toEqualTypeOf<Result<number, never>>();
expectTypeOf<Email>().not.toEqualTypeOf<string>();
expectTypeOf<Email>().toMatchTypeOf<string>(); // extends
```

**Pros**:

- API muy legible (parece jest/vitest).
- Mejores mensajes de error que `Expect<Equal<...>>`.
- Soporta más operadores (`toBeCallableWith`, `parameters`, `returns`, etc.).

**Contras**:

- Una dep más (vs cero deps con el patrón canónico).
- Las llamadas son **runtime calls** (no-op pero existen en el bundle). Hay que asegurarse de no incluirlas en producción.

Para nuestro proyecto (didáctico, minimal-deps) el patrón manual gana. Para librerías que vas a publicar con API tipo-pesada (kysely, drizzle, hono, zod…) `expect-type` es prácticamente estándar.

### `tsd` (estándar histórico)

[`tsd`](https://github.com/SamVerschueren/tsd) corre **una invocación tsc separada** que pasa flags más estrictos sobre un directorio dedicado. Filosóficamente alineado con DefinitelyTyped (`dtslint`).

**Cuándo**: cuando publicas tipos en npm y tu archivo `.d.ts` es el producto principal. Para un proyecto end-application, overkill.

### `dtslint` (Microsoft / DefinitelyTyped)

Si vas a contribuir a `@types/foo`, **tienes que** aprender `dtslint`. Annotation-based (`// $ExpectType X`, `// $ExpectError`). Riguroso pero engorroso. Out of scope aquí.

## ¿Cuándo escribir type-tests?

Senior heurística:

| Caso | Type-test |
|------|-----------|
| Tipo trivial (`type Foo = { x: number }`) | **No** — el cambio se ve en code review |
| Generic con inferencia compleja | **Sí** — los bugs son silenciosos |
| API público de librería | **Sí** — los consumidores rompen sin avisarte |
| Branded type | **Sí** — proteger las direcciones de subtipo |
| Discriminated union con narrowing | **Sí** — narrowing es la abstracción que vendes |
| Type derivado de schema (`z.infer`) | **Sí** — el schema cambia, el tipo debe cambiar igual |
| Wrapper interno (`assertNever`) | **No** — el bug se manifiesta en uso |

Regla práctica: si pudieras refactorizar el código de forma que **runtime tests siguen pasando pero los tipos se rompen**, escribe un type-test.

## Trampas comunes

### 1. `Equal<any, T>` correctamente devuelve false — pero el `any` se "esparce"

Si tienes `any` accidental en tu codebase, los tests Equal lo pueden detectar (porque devuelven false con cualquier no-any). Pero si tu propio test usa `any`, todo pasa trivialmente. **No uses `any` en type-tests** ni siquiera por pereza.

### 2. `Equal<{ a: 1 }, { readonly a: 1 }>` devuelve `true`

`readonly` no se considera estructuralmente distinto en la mayoría de comparaciones. Si necesitas distinguirlos (raro), necesitas un `EqualStrict` que use mapped types con `-readonly`.

### 3. Distribución sobre uniones en `Extends`

```ts
type T = Extends<string | number, string>; // depende de si tu Extends usa [X] extends [Y]
```

Con `X extends Y` directo: distribuye y da `boolean`. Con `[X] extends [Y]`: no distribuye, da `false`. **Nuestro helper usa la versión con tuple wrap** — comportamiento intuitivo para tests.

### 4. Type-tests "olvidados" en tsconfig

Si tu glob de `include` no captura los `.type-test.ts`, tsc no los toca. Tests pasan silenciosamente. Verifica con un test destructivo (capítulo arriba) que tsc realmente los compila.

### 5. `noUnusedLocals` rompe la convención `_01, _02`

Si activas `noUnusedLocals: true` (no lo tenemos), las assertions tipo `type _01 = Expect<...>` fallan por "type alias is never used". Solución: el patrón **tuple exportado** que usamos (`export type Tests = [...]`) sortea el problema porque la tupla está usada (exportada).

### 6. Los type-tests aceptan `any` accidental

```ts
const result: any = ok(42);
type T = ReturnType<typeof result>; // → any (porque result es any)
Expect<Equal<T, Result<number, never>>>; // false → ERROR
```

Pero si haces `Expect<Equal<any, Result<...>>>` directamente, también falla (correcto). El sistema es robusto.

### 7. Refactorización masiva: ten cuidado con falsos positivos

Si refactorizas un union de `A | B` a `B | A`, **TS los considera el mismo tipo**. Tus tests `Equal` pasan. Si esperabas detectar el reorder, tu test estaba mal escrito — el orden no es semántico.

## Trampas filosóficas

Type-tests **no son** un reemplazo de runtime tests. Verifican **diferentes cosas**:

| Caso | Lo cubre runtime test | Lo cubre type-test |
|------|----------------------|--------------------|
| El handler devuelve 201 con body correcto | ✅ | ❌ |
| `ok(42).value === 42` | ✅ | ❌ |
| El tipo de retorno de `ok` es `Result<T, never>` | ❌ | ✅ |
| El UNIQUE constraint de DB rechaza duplicados | ✅ | ❌ |
| `Email` no es asignable desde `string` | ❌ | ✅ |

Item 77 del libro (*Understand the Relationship Between Type Checking and Unit Testing*) es la lectura obligatoria de fondo.

## Ejercicio

1. **Verifica el sabotaje**: en `src/lib/result.type-test.ts`, cambia una assertion (p.ej. `Result<number, never>` → `Result<string, never>`). Ejecuta `npm run typecheck`. Observa el error. Restaura.

2. **Añade tests para `Result.error`**: verifica que después de un narrowing `if (!r.ok)`, el tipo de `r.error` es exactamente el `E` declarado. Pista: usa un type-test que extraiga el tipo del campo `error` de la rama `false`.

3. **Refactor canario**: cambia `tryCatch` para que devuelva `Promise<Result<T, unknown>>` en lugar de `Promise<Result<T, Error>>`. ¿Qué tests rompen? Restaura. Ahora cambia la firma original para que devuelva `Promise<Result<T, Error | TypeError>>`. ¿Qué tests rompen? Discute por qué.

4. **Brand sabotaje**: en `src/domain/user.ts`, quita `.brand<'Email'>()` del `EmailSchema`. Ejecuta typecheck. ¿Cuántos tests del archivo `user.type-test.ts` fallan? Restaura.

5. **Reto — `IsAny<T>`**: implementa un type predicate que detecte `any` de verdad (no confundir con `unknown`). Pista: la propiedad de `any` es que `0 extends 1 & X` es siempre `boolean` solo si `X = any`.

6. **Reto — `EqualStrict<X, Y>`**: extiende `Equal` para que sí distinga `{ a: 1 }` de `{ readonly a: 1 }`. Vas a necesitar mapped types con el modificador `-readonly`.

7. **Reto — `expect-type` integration**: instala `expect-type` como devDependency. Reescribe `result.type-test.ts` con su API. Compara legibilidad y mensajes de error. ¿Cuál preferirías a 1 año vista?

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 55 — *Write Tests for Your Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/test-your-types.md)** — el item de referencia. Explica `Equal` con el detalle teórico que aquí resumimos.
- **[Item 50 — *Think of Generics as Functions Between Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/functions-on-types.md)** — el modelo mental que permite leer `Equal<X, Y>` y entender por qué la doble función genérica hace lo que hace.
- **[Item 56 — *Pay Attention to How Types Display*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/type-display.md)** — cuando un type-test falla, el error te muestra la forma del tipo. Saber leerla es la mitad del debug.
- **[Item 77 — *Understand the Relationship Between Type Checking and Unit Testing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/types-or-tests.md)** — el porqué filosófico: type-tests y runtime tests cubren áreas distintas, no se sustituyen.

---

**Anterior:** [13 — CI/CD con GitHub Actions](./13-ci-cd.md)
**Siguiente:** [15 — Métricas con Prometheus](./15-metricas-prometheus.md)
