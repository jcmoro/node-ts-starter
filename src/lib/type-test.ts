/**
 * Type-level testing helpers.
 *
 * Estos tipos primitivos te permiten escribir asserts que el compilador
 * verifica. Un "test" pasa cuando el archivo compila; falla cuando
 * `tsc --noEmit` reporta un error. No hay assert library ni overhead en
 * runtime — todo desaparece al compilar.
 *
 * Inspirados en *Effective TypeScript* Item 55 — "Write Tests for Your Types".
 */

/** Asserts that a type is exactly `true`. Use to wrap an `Equal<>` claim. */
export type Expect<T extends true> = T;

/**
 * Structural equality between types. Returns `true` iff X and Y are mutually
 * assignable AND the checker considers them indistinguishable.
 *
 * Truco canónico: comparar dos firmas genéricas idénticas fuerza al checker a
 * evaluar identidad en lugar de asignabilidad mutua. Resultado:
 *   - `Equal<any, T>` devuelve `false` para cualquier `T` distinto de `any`.
 *   - `Equal<boolean, true | false>` devuelve `true` (correctamente — son
 *     el mismo tipo).
 *
 * Limitación conocida: `Equal<any, unknown>` devuelve `true` aunque son
 * conceptualmente distintos. Si necesitas distinguirlos, mira `IsAny<T>`
 * en libs como `type-fest`.
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;

/** Inverse of {@link Equal}. */
export type NotEqual<X, Y> = Equal<X, Y> extends true ? false : true;

/**
 * `true` iff X is assignable to Y (i.e. X is a subtype of Y).
 *
 * Usamos `[X] extends [Y]` en vez de `X extends Y` para evitar la
 * distribución sobre uniones: `Extends<string | number, string>` debe ser
 * `false`, no `boolean`.
 */
export type Extends<X, Y> = [X] extends [Y] ? true : false;

/** Inverse of {@link Extends}: `true` iff X is NOT assignable to Y. */
export type NotExtends<X, Y> = [X] extends [Y] ? false : true;
