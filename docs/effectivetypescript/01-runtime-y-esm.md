# 01 — Runtime y ESM

## El problema

TypeScript **no se ejecuta**. El runtime (Node, navegadores) sólo entiende JavaScript. Tradicionalmente esto significaba que en cada cambio había que:

1. Compilar `.ts` → `.js` con `tsc`.
2. Ejecutar el `.js` resultante.

O usar herramientas como `ts-node` o `tsx` que compilan al vuelo. El problema: una dependencia más, configuración propia, y a veces incompatibilidades con ESM, source maps o features nuevos de Node.

Si vienes de Go (`go run main.go`) o Python (`python main.py`), este paso de build se hace tedioso.

## La solución: Node 22 con `--experimental-strip-types`

Desde Node 22.6, hay un flag que permite ejecutar `.ts` directamente:

```bash
node --experimental-strip-types src/index.ts
```

¿Qué hace? **Borra las anotaciones de tipo** del código y ejecuta el JS resultante. No transforma, no compila — solo elimina. Esto es importante porque tiene **limitaciones**:

| Funciona                       | No funciona                            |
|--------------------------------|----------------------------------------|
| `type`, `interface`            | `enum` (genera código)                 |
| Anotaciones `: string`         | `namespace` (genera código)            |
| Generics                       | Legacy decorators (los nuevos sí)      |
| `as` (type assertion)          | Path aliases sin resolver              |
| `import type`                  | `.tsx` (necesita Node 22.7+)           |

La regla mental: **si la sintaxis sólo existe a nivel de tipo y desaparecería al compilar, funciona; si genera código JS, no**. Esto te empuja a un TS más "puro" — y eso, para aprender, es bueno.

> 🔎 En Node 23.6+ deja de ser experimental y se llama `type stripping`. Mismo flag, mismo comportamiento. En este proyecto mantenemos el nombre `--experimental-strip-types` para compatibilidad con 22.

## ESM en Node

Hay dos sistemas de módulos en JS:

- **CommonJS** (`require`, `module.exports`) — el histórico de Node.
- **ESM** (`import`, `export`) — el estándar de JavaScript moderno.

En este proyecto usamos **ESM puro**. En `package.json`:

```json
"type": "module"
```

Esto cambia varias cosas:

### 1. Imports con extensión explícita

```ts
// ✅ funciona
import { env } from './env.ts';

// ❌ no funciona en ESM estricto
import { env } from './env';
```

Esto choca al venir de Java/Python donde nunca pones la extensión. En ESM el resolver **no busca** — la URL debe ser literal. La extensión `.ts` (no `.js`) funciona porque `--experimental-strip-types` reescribe el resolver.

### 2. `import type` vs `import`

```ts
import type { Env } from './env.ts';     // sólo para tipos, se borra
import { env } from './env.ts';           // valor en runtime
```

Con `verbatimModuleSyntax` activado (lo veremos en el capítulo 02), TS te obliga a marcar como `type` lo que sólo se usa en tipos. Esto es **necesario** para strip-types: si dejaras un import sólo-tipo sin marcar, en runtime Node intentaría cargar un módulo que quizá no exporta nada de valor.

### 3. No hay `__dirname` ni `__filename`

```ts
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
```

Detalle pequeño pero te morderá la primera vez.

## El `package.json` del proyecto

```json
{
  "type": "module",
  "engines": { "node": ">=22.6.0" },
  "scripts": {
    "dev": "node --watch --experimental-strip-types --env-file=.env src/index.ts",
    "start": "node --experimental-strip-types --env-file=.env src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "node --test --experimental-strip-types 'src/**/*.test.ts'"
  }
}
```

Tres flags de Node que hacen el trabajo:

- `--watch` — reinicia al cambiar archivos (como `nodemon`, pero nativo).
- `--experimental-strip-types` — borra tipos al cargar.
- `--env-file=.env` — carga variables de entorno (como `dotenv`, pero nativo).

**Nota importante:** `tsc` sigue siendo necesario, pero sólo para:

1. **Type-checking** (`npm run typecheck`) — Node strip-types **no comprueba tipos**, solo los borra. Para validar que el código tipa bien, sigue siendo `tsc --noEmit`.
2. **Build de producción** (`npm run build`) — genera `dist/` con `.js` reales y `.d.ts`, sin depender del flag experimental.

En dev usas Node directo (rápido). En CI corres `typecheck` + `test`. Para deploy, `build` y ejecutas el `.js`.

## Comparación con otros lenguajes

| Lenguaje | Equivalente al "type-stripping"                                  |
|----------|------------------------------------------------------------------|
| Go       | No aplica — los tipos son parte del runtime.                     |
| Java     | No aplica — sin tipos no compila.                                |
| Python   | `mypy` (separado del runtime) — concepto similar: tipos son lint, no afectan ejecución. |
| PHP      | Type hints en runtime sí afectan (TypeError). En TS, jamás.      |

La intuición de **Python con `mypy`** es la más cercana: tus tipos son una capa de análisis estático sobre un lenguaje dinámico. En runtime, no existen.

## Trampas comunes

1. **Olvidar la extensión `.ts` en imports.** Error oscuro de módulo no encontrado. La fix: añadir `.ts`.
2. **Usar `enum`.** Falla en runtime. Alternativa idiomática TS:
   ```ts
   const Color = { Red: 'red', Blue: 'blue' } as const;
   type Color = typeof Color[keyof typeof Color]; // 'red' | 'blue'
   ```
3. **Esperar que `tsc` se ejecute en dev.** No lo hace. Si tienes un error de tipos, `npm run dev` no te avisa — el código corre. Acostúmbrate a tener `npm run typecheck` corriendo en watch en otra terminal, o que tu editor lo haga.
4. **Mezclar CommonJS y ESM.** Si una dependencia es CJS pura, puede haber fricción. Con `esModuleInterop: true` la mayoría funciona, pero ten el dato.

## Ejercicio

1. Arranca el server: `npm run dev`. Confirma que responde:
   ```bash
   curl http://localhost:3000/health
   ```
2. Edita `src/index.ts` y mete un `enum`:
   ```ts
   enum Status { Ok = 'ok' }
   app.get('/health', (c) => c.json({ status: Status.Ok }));
   ```
   Observa el error en runtime. Léelo con atención — la pista está en el mensaje.
3. Reemplázalo por el patrón `as const`:
   ```ts
   const Status = { Ok: 'ok' } as const;
   ```
   Confirma que funciona y que el tipo de `Status.Ok` es `'ok'` (literal), no `string`. Pásalo por el editor para verificarlo.
4. Quita `--experimental-strip-types` del script `dev` y vuelve a arrancar. ¿Qué error sale? ¿Por qué?

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 3 — *Code Generation Is Independent of Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-intro/independent.md)** — la base teórica de `--experimental-strip-types`: el JS emitido no depende de los tipos, los tipos son una capa que desaparece.
- **[Item 72 — *Prefer ECMAScript Features to TypeScript Features*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/avoid-non-ecma.md)** — por qué `enum`, `namespace` y los decorators legacy están proscritos: generan código JS no estándar que strip-types no puede borrar.
- **[Item 73 — *Use Source Maps to Debug TypeScript*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/source-maps-debug.md)** — el flag `sourceMap` del tsconfig y cómo se mapean stack traces back al `.ts` original.
- **[Item 79 — *Write Modern JavaScript*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-migrate/write-modern-js.md)** — las features de ESM que damos por sentadas (import/export, top-level await).

---

**Anterior:** [00 — Introducción](./00-intro.md)
**Siguiente:** [02 — tsconfig estricto](./02-tsconfig-strict.md)
