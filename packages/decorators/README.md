# @ts-starter/decorators-demo

> Demo runnable de **TC39 stage 3 standard decorators** (TS 5.0+, ES2022+). Aplica el ejercicio "Reto — `@log` decorator" del [doc 9 de Total TypeScript](../../docs/totaltypescript/09-typescript-only-features.md) y de [doc 8 — Classes](../../docs/totaltypescript/08-classes.md), ejercicio 6.

## Qué demuestra

Dos decoradores method-level, ambos TC39 estándar (sin `experimentalDecorators`):

- **`@log`** — loguea nombre, args y return (o resolution si es async).
- **`@timed`** — mide duración wall-clock; cubre el ciclo completo del Promise en métodos async.

Más un `UserService` de ejemplo que combina los dos:

```ts
class UserService {
  @log
  add(user: User): User { ... }

  @timed @log
  async findByEmailSlow(email: string): Promise<User | undefined> { ... }
}
```

El decorator stack `@timed @log` se aplica **de abajo arriba**: primero `@log` envuelve el método original, luego `@timed` envuelve el resultado.

## Por qué no usa `node --experimental-strip-types`

El stripper de Node 22/23 todavía **no soporta sintaxis de decoradores TC39** (a finales de 2025). Por eso este package compila explícitamente con `tsc`:

```bash
npm run build   # tsc emite dist/*.js
npm start       # build + node dist/example.js
```

Cuando Node integre soporte (probable en 2026), bastará con cambiar a `node --experimental-strip-types src/example.ts`.

## Salida del demo

```text
[log] add([{"id":"1","name":"Jose","email":"jose@example.com"}])
[log] add → { id: '1', name: 'Jose', email: 'jose@example.com' }
[log] findById(["missing"])
[log] findById → undefined
[log] findByEmailSlow(["maria@example.com"])
[log] findByEmailSlow → { id: '2', name: 'Maria', email: 'maria@example.com' }
[timed] findByEmailSlow took 81.72ms
```

## Anatomía del decorator (TC39 stage 3)

```ts
export function log<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): (this: This, ...args: Args) => Return {
  return function (this: This, ...args: Args): Return {
    // pre-hook
    const result = target.call(this, ...args);
    // post-hook
    return result;
  };
}
```

Diferencias con los decoradores "experimentales" (TS legacy con `experimentalDecorators`):

| Aspecto                 | Legacy TS (experimental)                  | TC39 standard (estable)               |
|-------------------------|--------------------------------------------|---------------------------------------|
| Flag requerido          | `experimentalDecorators: true`             | Ninguno; TS 5.0+ los entiende nativo   |
| Firma del decorator     | `(target, propKey, descriptor)`            | `(target, ClassMethodDecoratorContext)` |
| Modificación del target | Vía `descriptor.value =`                   | Devolviendo una nueva función           |
| Contexto                | Implícito (descriptor, propKey)            | Objeto `context` con name, kind, addInitializer, ... |
| `this` typing           | No tipado                                  | Generic `This` parámetro              |
| Reflection / metadata   | `reflect-metadata` polyfill                | `context.metadata` nativo (Symbol-keyed) |

Para código nuevo, **siempre usa TC39 standard**. El legacy queda para libs antiguas (Angular pre-17, NestJS pre-11, TypeORM clásico).

## Por qué nunca aparecerá en `services/node-api/`

`services/node-api/` es funcional por diseño: factories en lugar de classes, discriminated unions en lugar de polymorphism. Los decoradores requieren clases (TC39 stage 3 no soporta function decorators). Si quisieras un equivalente functional sería un **higher-order function**:

```ts
const logHof = <F extends (...args: any[]) => any>(name: string, fn: F): F => {
  return ((...args) => {
    console.log(`[log] ${name}(${JSON.stringify(args)})`);
    const result = fn(...args);
    console.log(`[log] ${name} →`, result);
    return result;
  }) as F;
};

export const createUser = logHof('createUser', _createUser);
```

Mismo efecto, sintaxis distinta. La elección entre uno y otro depende del estilo de la codebase.

## Build

```bash
npm install
npm run build       # tsc
npm start           # build + run
npm run typecheck   # tsc --noEmit
```
