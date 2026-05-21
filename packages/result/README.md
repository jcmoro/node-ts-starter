# @ts-starter/result

> Tiny `Result<T, E>` discriminated union for TypeScript — extracted from `node-ts-starter` as an example of authoring a publishable TS library.

## Por qué este package existe

Este paquete es **un ejercicio aplicado** del [doc 13 del track Total TypeScript](../../docs/totaltypescript/13-modules-and-declarations.md): "extrae `src/lib/result.ts` como paquete publicable". El módulo `Result<T, E>` original sigue viviendo en [`services/node-api/src/lib/result.ts`](../../services/node-api/src/lib/result.ts) porque el repo lo usa internamente; este `packages/result/` es la versión "lista para publicar a npm" con:

- `exports` map con condicionales `types` + `import` (Node 16+ resolution).
- `.d.ts` + `.d.ts.map` emitidos por `tsc` (los consumers pueden saltar del símbolo al fuente con `Go to Definition`).
- `files` limitado a `dist/` + docs (no se publica el `src/` ni el `tsconfig.json`).

## API

```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

const ok: <T>(value: T) => Result<T, never>;
const err: <E>(error: E) => Result<never, E>;
const tryCatch: <T>(fn: () => Promise<T>) => Promise<Result<T>>;
```

## Uso

```ts
import { ok, err, tryCatch, type Result } from '@ts-starter/result';

const r: Result<number, string> = ok(42);
if (r.ok) {
  console.log(r.value);   // narrowed: number
} else {
  console.log(r.error);   // narrowed: string
}

// Wrap throwing async code:
const fetched = await tryCatch(() => fetch('/users').then((r) => r.json()));
if (!fetched.ok) console.error(fetched.error);
```

## Build local

```bash
npm install
npm run build   # genera dist/ con index.js, index.d.ts, sourcemaps
```

## Publicar (hipotético)

```bash
npm version patch         # bump 0.1.0 → 0.1.1
npm publish --access public
```

El `prepublishOnly` script asegura un build fresco antes del publish.

## Sin workspaces — por qué

Este `packages/` no usa npm workspaces deliberadamente. La intención es que `@ts-starter/result` sea un **paquete autocontenido y publicable**, exactamente como aparecería en un repositorio standalone. El `services/node-api/` consume su propia copia del módulo (`src/lib/result.ts`) para no introducir un acoplamiento workspace que complicaría el ejercicio.

Si quisieras integrarlo realmente en el repo:

1. Añade `"workspaces": ["services/*", "web", "packages/*"]` a un `package.json` raíz nuevo.
2. En `services/node-api/package.json`: `"dependencies": { "@ts-starter/result": "*" }`.
3. Sustituye los imports de `'./lib/result.ts'` por `'@ts-starter/result'`.

Pero eso ya no es el ejercicio del doc 13.

## Licencia

MIT.
