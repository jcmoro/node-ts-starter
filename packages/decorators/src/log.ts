/**
 * `@log` method decorator (TC39 stage 3 — no `experimentalDecorators` needed).
 *
 * Logs the method name, arguments, and return value on each invocation.
 * Handles async methods automatically: if the return is a Promise, the
 * resolved value is logged when it settles.
 *
 * @example
 *   class Greeter {
 *     @log
 *     greet(name: string): string { return `hi, ${name}`; }
 *   }
 *
 *   new Greeter().greet('Jose');
 *   // [log] greet(["Jose"])
 *   // [log] greet → "hi, Jose"
 */
export function log<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): (this: This, ...args: Args) => Return {
  const methodName = String(context.name);

  return function (this: This, ...args: Args): Return {
    console.log(`[log] ${methodName}(${JSON.stringify(args)})`);
    const result = target.call(this, ...args);

    if (result instanceof Promise) {
      // Async path — log when the promise settles, don't block the return.
      result.then(
        (value) => console.log(`[log] ${methodName} →`, value),
        (error) => console.log(`[log] ${methodName} ✗`, error),
      );
    } else {
      console.log(`[log] ${methodName} →`, result);
    }

    return result;
  };
}
