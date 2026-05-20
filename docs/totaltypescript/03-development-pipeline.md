# 03 — TypeScript In The Development Pipeline

> 📖 Capítulo original: [TypeScript In The Development Pipeline](https://www.totaltypescript.com/books/total-typescript-essentials/typescript-in-the-development-pipeline)

## Qué cubre Matt

Cómo encaja TS en el ciclo de vida del código: editor → compile → run → CI. Conceptualmente sencillo pero con consecuencias prácticas para cómo organizas un proyecto.

### Las ideas clave

#### 1. Los browsers (y Node hasta hace poco) **no entienden `.ts`**

```ts
const name: string = "Jose";   // ❌ SyntaxError en runtime sin transpile
```

Las anotaciones (`: string`) son sintaxis exclusiva de TS. Un runtime puro las rechaza. **Algo tiene que quitarlas antes de ejecutar**:

- `tsc` clásico: lee `.ts`, escribe `.js`. Acto explícito de build.
- Vite, esbuild, swc, tsx, etc.: hacen transpile on-the-fly (en memoria, sin emitir archivos).
- **Node 22 con `--experimental-strip-types`** (lo que usamos en el repo): el propio runtime borra los tipos en parse-time.

#### 2. `tsc --watch` para feedback continuo

Sin build tool moderno, el flujo clásico era:

```bash
tsc --watch   # recompila .ts → .js cada vez que cambias algo
node dist/index.js
```

Útil **cuando** estás aprendiendo TS o haces un script aislado. Para apps reales, hay opciones mejores (próximo punto).

#### 3. Type checking ≠ transpiling — y la mayoría de tools modernas **NO type-checkean**

Vite, esbuild, swc, ts-node `--swc`, tsx... todas hacen **solo transpile** (rápido, en memoria, ignora tipos). El type checking **es un paso separado**:

```bash
# Run rápido (sin type checking):
vite dev
# Type checking en CI o pre-commit:
tsc --noEmit
```

**Esta es la división crítica** que todo dev TS debe internalizar:

| Fase                  | Tool típico                | Hace type check |
|-----------------------|----------------------------|-----------------|
| Editor en vivo        | TS Language Server (LSP)   | ✅              |
| Dev server / run      | Vite / esbuild / swc / tsx | ❌              |
| Build de producción   | Vite / esbuild / swc       | ❌ (usualmente) |
| Pre-commit / CI       | `tsc --noEmit`             | ✅              |

Si confías solo en tu dev server para type checking, **no estás validando los tipos**. Esto sorprende a muchos: "pero compiló y arrancó", sí, pero el `string` que pasaste donde se esperaba `number` no se detectó. **El CI debe correr `tsc --noEmit` explícitamente**.

#### 4. `noEmit: true` como modo "linter"

Cuando ya tienes Vite/esbuild emitiendo el JS, ¿para qué quieres que `tsc` emita también? `noEmit: true` hace que `tsc` **solo valide tipos** y no escupa archivos:

```json
{
  "compilerOptions": {
    "noEmit": true,
    // ...
  }
}
```

Es exactamente lo que hace nuestro `services/node-api/tsconfig.json`. `tsc` se convierte en un **type-checker puro**.

## Cómo se aplica al repo

### Pipeline del Node-API

```
.ts source ──► [TS Language Server]    ◄── editor en vivo
            ├─► [node --experimental-strip-types]  ◄── runtime: dev + prod
            └─► [tsc --noEmit]          ◄── CI: type check explícito
```

**Sin build step**. Node 22 borra los tipos directamente. `tsc` solo se invoca para validar.

Verifica en el repo:
- [`services/node-api/package.json`](../../services/node-api/package.json): scripts `start` y `dev` usan `node --experimental-strip-types`.
- [`services/node-api/tsconfig.json`](../../services/node-api/tsconfig.json): `"noEmit": true`.
- [Makefile target `node-typecheck`](../../Makefile): `tsc --noEmit` que valida.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): job `node-quality` que llama a `make node-check` (incluye typecheck).

### Pipeline del web (Vite)

```
.ts source ──► [TS Language Server]   ◄── editor en vivo
            ├─► [Vite dev server]      ◄── transpile en memoria
            ├─► [Vite build]            ◄── producción
            └─► [tsc --noEmit]          ◄── type check separado
```

[`web/package.json`](../../web/package.json) tiene:
- `dev`: Vite (sin type check).
- `build`: Vite (sin type check).
- `typecheck`: `tsc --noEmit` (type check).

Resultado: Vite arranca **instantáneamente** porque no espera al type checker. El type checker corre cuando tú o el CI lo invocan explícitamente.

## Cómo se compara con nuestro track

- [Doc 01 — Runtime y ESM](../effectivetypescript/01-runtime-y-esm.md) cubre por qué usamos `--experimental-strip-types` y qué implica.
- [Doc 02 — tsconfig estricto](../effectivetypescript/02-tsconfig-strict.md) cubre `noEmit` y cómo configurar `tsc` como linter.
- [Doc 13 — CI/CD](../effectivetypescript/13-ci-cd.md) cubre la validación en CI.

El capítulo de Matt **es la "vista de pájaro"** de todo eso. Si quieres el detalle de cada parte, lee nuestros docs después.

## Ideas que merecen anotarse

### "Type checking is separate from compiling"

La frase de marketing es:

> "Just because it builds doesn't mean it's correct."

Hace falta interiorizarlo. Equipos con buenos dev servers pero CI sin `tsc --noEmit` viven en un mundo donde **los tipos solo importan en el editor**. En `main` se cuelan errores que el LSP del PR-er sí veía pero nadie verificó al merge.

### Performance del type checking

`tsc --noEmit` puede ser lento en codebases grandes. Estrategias:

- **`incremental: true`** en `tsconfig.json` — guarda un `.tsbuildinfo` con info de la última build. Type-checks subsequentes son delta.
- **`tsc --build`** modes para monorepos con `references`.
- **`tsc --watch` en una terminal aparte** durante dev — feedback inmediato sin esperar el LSP.

### Source maps

Cuando emites JS (no es nuestro caso, pero sí del web Vite-built):

```json
{ "compilerOptions": { "sourceMap": true } }
```

Genera `.js.map` que el debugger usa para mostrarte el `.ts` original aunque ejecute el `.js`. **Imprescindible** para debugging in-browser. Vite los activa por defecto.

## Ejercicio

1. **Verifica los dos caminos**: en `services/node-api/`, corre `npm run dev`. Funciona — sin emitir JS. Luego `npm run typecheck` por separado. ¿Cuándo querrías cada uno?

2. **Rompe los tipos pero no el runtime**: en `services/node-api/src/index.ts`, fuerza un error tipo `const x: number = "string" as any;` con `as any`. `npm run dev` arranca igual. `npm run typecheck` quizá no protesta (porque hiciste `as any`). Quita el `as any`. Ahora typecheck falla pero dev sigue funcionando si no toca esa línea en runtime. Esto **es** la división separada.

3. **CI verde sin type check**: imagina un workflow que solo corre `npm run dev` brevemente para "probar que arranca". ¿Por qué eso es **insuficiente**? ¿Qué bugs se cuelan?

4. **`tsc --watch` para dev intensivo de tipos**: cuando estés trabajando en code muy genérico (cambiando un tipo profundo y viendo cuántos sites rompen), abre una terminal con `cd services/node-api && npx tsc --noEmit --watch`. Verás los errores aparecer y desaparecer en tiempo real.

5. **Reto — incremental**: añade `"incremental": true` a `services/node-api/tsconfig.json` y un primer `tsc --noEmit`. Mira el `.tsbuildinfo` que aparece. Corre un segundo `tsc --noEmit` — debería ser más rápido. Añade `*.tsbuildinfo` a `.gitignore`.

## 📖 Otros recursos

- [TypeScript Handbook — Compiler Options](https://www.typescriptlang.org/tsconfig) — referencia exhaustiva.
- [TypeScript — Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) — para monorepos con build dependencies.
- [Vite — Why Vite is fast](https://vitejs.dev/guide/why.html) — la explicación canónica de "transpile-only is enough for dev".

---

**Anterior:** [02 — IDE Superpowers](./02-ide-superpowers.md)
**Siguiente:** [04 — Essential Types and Annotations](./04-essential-types.md)
