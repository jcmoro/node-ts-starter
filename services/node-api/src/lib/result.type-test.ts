import type { Result, err, ok, tryCatch } from './result.ts';
import type { Equal, Expect, Extends } from './type-test.ts';

export type Tests = [
  // ok<T>(value) devuelve Result<T, never>. El `never` en el slot de error es
  // intencional (cap. 04) para que sea asignable a cualquier Result<T, E>.
  Expect<Equal<ReturnType<typeof ok<number>>, Result<number, never>>>,
  Expect<Equal<ReturnType<typeof ok<'literal'>>, Result<'literal', never>>>,
  // err<E>(error) devuelve Result<never, E>. Simétrico al anterior.
  Expect<Equal<ReturnType<typeof err<Error>>, Result<never, Error>>>,
  Expect<Equal<ReturnType<typeof err<{ kind: 'x' }>>, Result<never, { kind: 'x' }>>>,
  // tryCatch siempre envuelve en Error (su firma garantiza Error, no unknown).
  Expect<Equal<ReturnType<typeof tryCatch<string>>, Promise<Result<string, Error>>>>,
  // Result<T> con un solo argumento aplica el default `E = Error`.
  Expect<Equal<Result<number>, Result<number, Error>>>,
  // Una rama concreta es subtipo del Result completo (narrowing direction).
  Expect<Extends<{ ok: true; value: number }, Result<number, never>>>,
  Expect<Extends<{ ok: false; error: Error }, Result<never, Error>>>,
];
