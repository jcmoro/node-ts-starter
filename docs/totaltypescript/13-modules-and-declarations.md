# 13 — Modules, Scripts, and Declaration Files

> 📖 Capítulo original: [Modules, Scripts, and Declaration Files](https://www.totaltypescript.com/books/total-typescript-essentials/modules-scripts-and-declaration-files)

## Qué cubre Matt — HUECO PARCIAL

Tres bloques:

1. **Modules vs Scripts** — la distinción crítica que TS hace para cada archivo.
2. **Declaration files (`.d.ts`)** — qué son, cómo describen JS, `declare` keyword.
3. **Authoring declarations** — augmentar globales, tipar imports no-JS, cuándo y cuándo no.

Cubrimos parcialmente en [doc 23 — Declaration merging](../effectivetypescript/23-declaration-merging.md) (la parte de augmentation). Lo que añade Matt sobre lo nuestro: **publishing TS libs con `.d.ts`** propio y la distinción module/script.

## Lo que importa

### Modules vs Scripts — la pregunta que TS responde por cada archivo

```ts
// Si tu .ts tiene un export o import...
export function foo() {}
// → es un MODULE. Su contenido es local.

// Si no tiene ninguno...
function bar() {}
// → es un SCRIPT. Su contenido es GLOBAL.
```

**Consecuencias del script mode**:

- Variables declaradas son globales — accesibles desde cualquier `.ts` del proyecto.
- Conflictos: si dos archivos declaran `const x`, error "cannot redeclare block-scoped variable".

**Forzar modules**:

```json
{
  "compilerOptions": {
    "moduleDetection": "force"
  }
}
```

Cada `.ts` se trata como módulo automáticamente, incluso sin import/export. Nuestro tsconfig lo tiene activo (`moduleDetection: "force"` en `services/node-api/tsconfig.json`).

### `declare` keyword — declaraciones sin implementación

```ts
declare const VERSION: string;          // existe en runtime, no aquí
declare function alert(msg: string): void;
declare class MyClass {
  method(): void;
}

declare module 'some-untyped-lib' {
  export function doSomething(): void;
}

declare global {
  interface Window {
    myApp: { version: string };
  }
}
```

`declare` dice **"TS, confía en mí, esto existe en runtime"**. No emite código.

Usos típicos:

- **`declare const`** — variables globales del runtime (e.g. `__VERSION__` inyectado por el bundler).
- **`declare function`** — APIs como `alert` que no están en types de Node pero sí en browser.
- **`declare module 'x'`** — describir el shape de un módulo cuyo `.d.ts` no existe.
- **`declare global { ... }`** — añadir items al global scope desde dentro de un módulo.

### `.d.ts` files — descripción pura de JS

Un archivo `.d.ts` **solo contiene declarations**, sin implementación:

```ts
// my-lib.d.ts
export function greet(name: string): string;
export const VERSION: string;
export interface User { id: string; name: string }
```

Es como un "interface" de Java/C# para toda una API. Las libs npm publican `.d.ts` (vía `"types"` en `package.json`) para que sus consumers TS las usen tipadas.

### Module augmentation vs override

Cubierto en nuestro [doc 23](../effectivetypescript/23-declaration-merging.md):

```ts
// Augmentation — extiendes lo que existe
declare module 'express' {
  interface Request {
    userId?: string;
  }
}

// Override — defines un módulo nuevo (sin export-import del original)
declare module 'totally-untyped-lib' {
  export function foo(): void;
}
```

La regla: si el archivo `.d.ts` **no tiene import/export top-level**, es un script y `declare module 'x'` define el módulo desde cero. Si tiene cualquier `import 'x'` o `export`, augmenta.

### `skipLibCheck` — performance

```json
{ "compilerOptions": { "skipLibCheck": true } }
```

Le dice a TS: **no chequees los `.d.ts` de tus deps**. Asume que están bien.

Sin `skipLibCheck`, TS valida cada `.d.ts` de cada dep. En un repo con muchas deps, esto añade segundos al typecheck.

Activo en nuestro tsconfig — recomendado en cualquier proyecto serio.

### Authoring `.d.ts` para publishing — el hueco real

Si publicas un paquete TS:

```json
{
  "name": "my-lib",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

`tsc` con `"declaration": true` genera los `.d.ts` automáticamente desde tu `.ts`. Los consumers obtienen los tipos al hacer `npm install`.

**Setup mínimo**:

```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  }
}
```

`declarationMap` genera `.d.ts.map` que enlaza la declaration al `.ts` original — los consumers pueden saltar desde el tipo declarado al código fuente en `node_modules/.../src/`. Es un nice-to-have.

### Cuándo `.d.ts` en tu repo (no publicado)

```ts
// src/types/env.d.ts
declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string;
    LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  }
}
```

Para augmentar tipos de libs (Express, Node, lo que sea). Vive en `src/types/` (o donde tu tsconfig `include` lo capte) y aplica globalmente.

**Matt y nuestra recomendación**: NO uses `.d.ts` para definir tus propios tipos. Usa `.ts` normal con `export`. `.d.ts` es para **declarar** code de runtime que no tienes — no para code de tipos puro.

## Cómo se compara con nuestro track

[Doc 01 — Runtime y ESM](../effectivetypescript/01-runtime-y-esm.md) cubre ESM vs CommonJS, `verbatimModuleSyntax`.
[Doc 23 — Declaration merging](../effectivetypescript/23-declaration-merging.md) cubre module augmentation a fondo (Express Request, NodeJS.ProcessEnv).

**Lo nuevo de este capítulo**:
- **Authoring `.d.ts`** para publishing — no lo cubrimos. Si publicas libs npm, este capítulo es clave.
- **Modules vs Scripts** — implícito en nuestros docs (asumimos `moduleDetection: force`), pero útil saberlo explícitamente para diagnosticar "Cannot redeclare block-scoped variable".

## Ideas que merecen anotarse

### "DefinitelyTyped" — el repo comunitario

[github.com/DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) es donde la comunidad mantiene `@types/*` packages para libs JS sin tipos. Cuando haces `npm install @types/express`, sale de ahí.

Si necesitas tipar una lib sin tipos, contribuir un `@types/<lib>` es la vía canónica (en lugar de mantenerlo solo en tu repo con `declare module`).

### "Should you store types in `.d.ts`?" — No

Tentación: poner todos los tipos públicos en un `types.d.ts`. **Antipatrón**. Razones:

- `.d.ts` no puede contener implementación. Tarde o temprano querrás añadir un helper junto al tipo, y tendrás que mover todo.
- `.d.ts` tiene reglas distintas (declare-only, namespace blocks).
- Confunde — un dev que ve `User.d.ts` piensa "esto es para una lib externa", no para tu propio dominio.

**Regla**: tipos propios → `.ts` con `export`. `.d.ts` solo para describir runtime que no es tuyo.

### Las trampas de `declare module 'x'`

Si haces:

```ts
// my-augmentation.d.ts (script mode)
declare module 'express' { ... }
```

Y olvidas el `import` top-level que convierta el archivo en module, **estás OVERRIDING `express`**, no augmenting. Los consumers que importen `express` verán solo lo que tú declaraste, perdiendo todo lo original.

Fix:

```ts
import 'express';   // convierte el archivo en module

declare module 'express' {
  interface Request { userId?: string }
}
```

El `import` no se usa runtime — solo para señalar al compilador "soy un módulo, augmento".

## Ejercicio

1. **Auditar `moduleDetection`**: en `services/node-api/tsconfig.json`, confirma que `moduleDetection: "force"` está activo. Crea un archivo `src/foo.ts` sin imports/exports y declara `const x = 1`. Sin `force`, TS te diría "Cannot redeclare...". Con `force`, sí funciona.

2. **`.d.ts` para env**: en `services/node-api/src/types/env.d.ts`, augmenta `NodeJS.ProcessEnv` con las variables específicas del proyecto (`DATABASE_URL`, `LOG_LEVEL`, etc.). Confirma que `process.env.DATABASE_URL` tiene tipo `string` (no `string | undefined`).

3. **`declare module` para una lib sin tipos**: encuentra alguna lib npm que uses sin tipos (raro en TS, pero algunas viejas). Crea `src/types/that-lib.d.ts` con un `declare module 'that-lib' { ... }` mínimo. Confirma que el import compila.

4. **Reto — publicar `lib/result.ts` como paquete**: extrae `services/node-api/src/lib/result.ts` a una carpeta nueva (`packages/result/`). Crea un `package.json` y `tsconfig.json` propios. `tsc --declaration` genera `.d.ts`. Confirma que desde otro proyecto, `import { ok, err } from '@my-org/result'` da los tipos correctos.

5. **`skipLibCheck` impacto**: temporalmente quita `skipLibCheck: true` de tu tsconfig. Mide cuánto tarda `tsc --noEmit`. Vuélvelo a poner. La diferencia debería ser sustancial en codebases con muchas deps.

## 📖 Otros recursos

- [TypeScript Handbook — Declaration Files](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html) — guía completa.
- [TypeScript Handbook — Declaration Reference](https://www.typescriptlang.org/docs/handbook/declaration-files/by-example.html) — patrones canónicos.
- [DefinitelyTyped contribution guide](https://github.com/DefinitelyTyped/DefinitelyTyped#how-can-i-contribute) — cómo aportar `@types/*`.
- [Andrew Branch — "What's behind the question mark?"](https://blog.andrewbran.ch/) — posts sobre internals de declarations.

---

**Anterior:** [12 — The Weird Parts](./12-the-weird-parts.md)
**Siguiente:** [14 — Configuring TypeScript](./14-configuring-typescript.md)
