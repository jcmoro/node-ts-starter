/**
 * `@timed` method decorator (TC39 stage 3 — no `experimentalDecorators` needed).
 *
 * Measures wall-clock duration of each invocation. For async methods, the
 * duration covers the full Promise lifecycle (including the awaited I/O).
 *
 * @example
 *   class Service {
 *     @timed
 *     async heavy(): Promise<number> { ... }
 *   }
 *   // [timed] heavy took 142.3ms
 */
export function timed<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): (this: This, ...args: Args) => Return {
  const methodName = String(context.name);

  return function (this: This, ...args: Args): Return {
    const start = performance.now();
    const result = target.call(this, ...args);

    const reportDuration = (): void => {
      const ms = (performance.now() - start).toFixed(2);
      console.log(`[timed] ${methodName} took ${ms}ms`);
    };

    if (result instanceof Promise) {
      result.finally(reportDuration);
    } else {
      reportDuration();
    }

    return result;
  };
}
