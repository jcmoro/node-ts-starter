# 14 — Configuring TypeScript

> 📖 Capítulo original: [Configuring TypeScript](https://www.totaltypescript.com/books/total-typescript-essentials/configuring-typescript)

## Qué cubre Matt

Una recorrida exhaustiva por las opciones de `tsconfig.json` con recomendaciones concretas. Es el complemento práctico del cap. 3 (development pipeline).

Bloques:

1. **Base options** que todo proyecto necesita.
2. **Strictness** — los flags que evitan bugs.
3. **`module`** — dos elecciones modernas (`NodeNext` o `Preserve`).
4. **`verbatimModuleSyntax` + `import type`** — sobre transpile-only tools.
5. **ESM vs CommonJS** — detección y emisión.
6. **`noEmit`, source maps, declarations, JSX**.
7. **Múltiples tsconfigs** — `extends`, project references.

## Lo más relevante (lo que nuestro doc 02 no cubre con esta granularidad)

### Las dos elecciones para `module`

```json
{
  "compilerOptions": {
    "module": "NodeNext"      // si compilas con tsc, target Node
    // o
    "module": "Preserve"       // si transpilas con Vite, esbuild, swc, etc.
  }
}
```

**Recomendación de Matt**:

- **`NodeNext`**: si `tsc` emite los `.js` finales. Module system depende del package.json `"type"` y la extensión.
- **`Preserve`**: si un bundler externo (Vite, esbuild) hace el transpile. Le dice a TS "preserva la sintaxis ES tal cual; el bundler decidirá".

Nuestro `services/node-api/tsconfig.json` usa `NodeNext` porque Node lee los `.ts` con strip-types (no compilamos con bundler). El `web/tsconfig.json` también podría usar `Preserve` (Vite es el transpiler) — verifica el del repo.

### `verbatimModuleSyntax: true` — el flag moderno

```ts
// Sin verbatim
import { User } from './user';   // TS puede borrar el import si User es solo type — frágil

// Con verbatim
import { type User } from './user';        // ✅ explícito
import type { User } from './user';        // ✅ alternativa
import { User } from './user';              // ❌ si User es solo type
```

`verbatimModuleSyntax` **obliga a marcar type-only imports explícitamente**. Razón: transpile-only tools (Vite, esbuild) no saben qué es type vs valor. Sin la marca, podrían incluir el import en runtime causando errores (módulo no existe en JS) o no eliminarlo cuando deberían.

Activo en nuestro tsconfig — lo viste en [doc 01](../effectivetypescript/01-runtime-y-esm.md) y [doc 12 (weird parts)](./12-the-weird-parts.md).

### Strictness — el set canónico

```json
{
  "compilerOptions": {
    "strict": true,                              // active 8 flags clave
    "noUncheckedIndexedAccess": true,             // adicional, muy recomendado
    "noImplicitOverride": true,                   // useful en code OO
    "exactOptionalPropertyTypes": true,           // strict opcional fields
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,   // obliga obj['x'] para index
    "useUnknownInCatchVariables": true             // catch (e: unknown), no any
  }
}
```

Matt recomienda todos. Nuestro repo los tiene todos activos.

`strict: true` por sí solo activa:
- `noImplicitAny`
- `strictNullChecks`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `alwaysStrict`
- `noImplicitThis`
- `useUnknownInCatchVariables`

Los demás flags son opt-in por separado (`noUncheckedIndexedAccess`, etc.).

### `noEmit` para "tsc as linter"

```json
{ "noEmit": true }
```

Cuando un bundler hace el transpile (Vite, esbuild, tsx, Node 22 strip-types), `tsc` se usa solo para validar tipos. Sin `noEmit`, `tsc` escupe archivos `.js` que nadie usa. **Activo** en nuestro repo.

### Source maps

```json
{ "sourceMap": true }
```

Genera `.js.map` que el debugger usa para mapear breakpoints al `.ts` original. **Crítico para debugging in-browser**. Vite los activa por defecto.

Para producción: deja `false` para reducir tamaño del bundle, o si tu monitoring (Sentry, etc.) los sube separadamente, mantenlos pero excluye del deploy.

### Multiple tsconfigs — `extends` y project references

```json
// tsconfig.base.json
{
  "compilerOptions": { "strict": true, "target": "ES2023" }
}

// services/node-api/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "NodeNext" }
}

// web/tsconfig.json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM"] }
}
```

**Project references** son otro nivel — para monorepos con dependencias entre proyectos TS:

```json
{
  "references": [
    { "path": "../shared" }
  ]
}
```

Permite a `tsc --build` orquestar el build en orden topológico. Útil cuando tu repo tiene paquetes que dependen entre sí. Nuestro repo no lo usa porque cada servicio es independiente.

## Cómo se compara con nuestro track

[Doc 02 — tsconfig estricto](../effectivetypescript/02-tsconfig-strict.md) cubre los flags activos en nuestro `services/node-api/tsconfig.json` con justificación. Matt los explica genéricos; nosotros los justificamos para nuestro caso.

Lo nuevo que añade Matt:
- **`module: Preserve`** opción moderna para bundlers.
- **`extends` y project references** — patrón para monorepos.
- **Una vista general** de qué flags afectan qué (emit, strictness, module, jsx).

## Ideas que merecen anotarse

### Las dos preguntas que decide tu tsconfig

Antes de copiar un tsconfig de internet, pregúntate:

1. **¿`tsc` emite los `.js` finales, o lo hace otro tool?**
   - tsc emite → `module: NodeNext` o `CommonJS`. Activa `outDir`, `declaration`, `sourceMap` según necesidad.
   - Otro tool (Vite, esbuild, Node strip-types) → `module: Preserve`, `noEmit: true`.

2. **¿Quién consume el código?**
   - Browser → `lib: ["ES2023", "DOM"]`, `target: "ES2020"` (o más conservador).
   - Node → `lib: ["ES2023"]`, `target: "ES2022"` o superior.
   - Lib publicada → necesitas `declaration: true`, `outDir`.

Las dos preguntas determinan ~80% de los flags.

### `target` no es lo que crees

```json
{ "target": "ES2022" }
```

**No es "compila para Node 16+"**. Es "transforma sintaxis a ES2022, suprime cualquier feature posterior". El runtime que consume **igualmente tiene que soportar ES2022**.

Si target es ES2022 y corres en Node 14, fallas. Si target es ES5 y corres en Node 22, también funciona (over-conservative pero válido).

Para Node moderno (16+), `target: "ES2022"` o `"ES2023"` está bien.

### `lib` configura qué globals existen

```json
{ "lib": ["ES2023", "DOM"] }
```

`DOM` añade `document`, `window`, `fetch` (built-in en browsers). Sin él, esos identificadores no existen en TS.

Nuestro `web/tsconfig.json` incluye `"DOM"`. `services/node-api/tsconfig.json` no — Node no tiene DOM, sería confuso ofrecer types que no existen runtime.

## Ejercicio

1. **Audit completo del tsconfig**: abre `services/node-api/tsconfig.json` y cada flag pásalo por una herramienta como [TypeScriptLang Playground](https://www.typescriptlang.org/play) → "TS Config". ¿Sabes para qué sirve cada uno? Si no, busca en [tsconfig reference](https://www.typescriptlang.org/tsconfig).

2. **`extends` para reducir duplicación**: crea `tsconfig.base.json` en la raíz del repo con los flags compartidos por `services/node-api/` y `web/`. Refactoriza los dos a `extends`. Compara la legibilidad.

3. **`noEmit: false` temporal**: temporalmente cambia `noEmit` a `false` en `services/node-api/tsconfig.json` y corre `tsc`. Verás `dist/` aparecer con `.js`. Mira el código emitido. Revierte después.

4. **`module: Preserve` en web**: si `web/tsconfig.json` usa `module: ESNext` o `NodeNext`, cámbialo a `Preserve` (TS 5.4+). Verifica que `npm run build` (Vite) sigue funcionando. La diferencia: TS preserva las `import`/`export` exactas, Vite las procesa.

5. **Reto — project references**: si tienes tiempo, refactoriza `services/node-api/` y `services/spring-api/` (skip — spring no es TS) para que ambos extiendan un `packages/shared/` con tipos comunes. Configura project references. Corre `tsc --build`.

## 📖 Otros recursos

- [TypeScript Reference — tsconfig.json options](https://www.typescriptlang.org/tsconfig) — referencia exhaustiva con descripción de cada flag.
- [TSConfig Bases](https://github.com/tsconfig/bases) — set de tsconfigs base mantenidos por la comunidad (`@tsconfig/node22`, `@tsconfig/vite`, etc.).
- [Matt Pocock — "TSConfig cheatsheet"](https://www.totaltypescript.com/tsconfig-cheat-sheet) — pdf descargable con la receta de Matt.

---

**Anterior:** [13 — Modules, Scripts, and Declaration Files](./13-modules-and-declarations.md)
**Siguiente:** [15 — Designing Your Types](./15-designing-your-types.md)
