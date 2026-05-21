/**
 * `Result<T, E>` — a discriminated union for operations that can fail.
 *
 * The success branch carries the value, the failure branch carries the error.
 * The `ok` field is the discriminant: TypeScript narrows the union to the
 * right shape based on its value.
 *
 * @example
 *   const r = await tryCatch(() => fetch('/users'));
 *   if (!r.ok) {
 *     console.error(r.error.message);
 *     return;
 *   }
 *   console.log(r.value);
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Build a success result. Returns `Result<T, never>` so it composes with
 * any declared error type without widening.
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * Build a failure result. Returns `Result<never, E>` for the same composition
 * reason as `ok`.
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Adapt a Promise-returning function into a Result-returning one. Non-Error
 * throws are wrapped into an `Error` so the error branch always has a
 * predictable shape.
 *
 * @example
 *   const r = await tryCatch(() => fetch('/users').then(r => r.json()));
 *   if (!r.ok) return logger.error(r.error);
 *   process(r.value);
 */
export const tryCatch = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
