import type { Equal, Expect, Extends, NotEqual, NotExtends } from './type-test.ts';

// Meta-tests: verifican que los propios helpers se comportan como esperamos.
// Si tsc compila este archivo, los tests pasan.
export type Tests = [
  // ---------- Equal: positivos ----------
  Expect<Equal<string, string>>,
  Expect<Equal<number, number>>,
  Expect<Equal<{ a: number }, { a: number }>>,
  Expect<Equal<Promise<number>, Promise<number>>>,
  Expect<Equal<boolean, true | false>>, // boolean ES true | false estructuralmente
  // ---------- Equal: el truco canónico funciona ----------
  Expect<NotEqual<string, number>>,
  Expect<NotEqual<true, boolean>>, // true es subset, no igual
  // biome-ignore lint/suspicious/noExplicitAny: estamos testeando precisamente Equal contra any
  Expect<NotEqual<any, string>>,
  // biome-ignore lint/suspicious/noExplicitAny: idem
  Expect<NotEqual<any, never>>,
  Expect<NotEqual<unknown, string>>,
  // ---------- Extends: subtipo (no distribuye gracias a [X] extends [Y]) ----------
  Expect<Extends<'literal', string>>,
  Expect<Extends<{ a: 1; b: 2 }, { a: 1 }>>, // structural width
  Expect<NotExtends<{ a: 1 }, { a: 1; b: 2 }>>, // falta `b`
  Expect<NotExtends<string, 'literal'>>,
  Expect<NotExtends<string | number, string>>, // no distribuye → no es subtipo
];
