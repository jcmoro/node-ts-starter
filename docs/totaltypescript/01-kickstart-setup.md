# 01 — Kickstart Your TypeScript Setup

> 📖 Capítulo original: [Kickstart Your TypeScript Setup](https://www.totaltypescript.com/books/total-typescript-essentials/kickstart-your-typescript-setup)

## Qué cubre Matt

Capítulo introductorio. Recorre la historia del lenguaje, cómo encajan las piezas (`.ts` → IDE language server + `tsc` → `.js`), y deja al lector con un entorno mínimo funcional: VSCode + Node.js + `tsc` instalado.

Las ideas que merecen destacarse:

### 1. TypeScript nació para **tooling**, no para "strong typing"

Microsoft creó TS porque vio equipos usando *Script#* (un transpiler de C# a JS) por la falta de feedback en el IDE. Anders Hejlsberg (también padre de C# y Delphi) diseñó TS con un objetivo principal: dar a JS **autocompletado, refactor seguro, navegación cruzada de símbolos**. La tipificación es **el medio**, no el fin.

Esto explica varias decisiones que confunden a devs viniendo de Java/C#:

- TS **no garantiza correctitud en runtime** — el compilador desaparece, queda JS. Los tipos son una herramienta del editor, no una garantía ejecutiva.
- TS abraza la flexibilidad de JS donde otros sistemas de tipos serían más estrictos (tipado estructural, `any` como escape, sin checked exceptions).
- La meta es **"just enough strong typing"**, no "tantos tipos como sea posible".

### 2. El modelo: language server + compiler

Dos piezas separadas que comparten el mismo type-checker:

```
.ts file ──► [TS Language Server]   ◄── tu IDE consulta tipos al moverse
         └─► [tsc CLI]              ◄── tu build / CI emite .js o valida
```

Ambos son **el mismo motor** ejecutado en modos distintos:
- En el IDE corre **continuamente** y responde con baja latencia (autocompletado, hover, errores en rojo).
- En CLI corre **una sola vez** (típicamente `tsc --noEmit` en CI).

Implicación práctica: si el IDE te dice algo distinto al `tsc` del build, **suele haber un mismatch de versión** (IDE usa una y el build otra). Verificable con `tsc --version` y la versión del workspace en el statusbar de VSCode.

### 3. Setup mínimo según Matt

- **VSCode** como editor (Microsoft, soporte nativo).
- **Node.js LTS** desde nodejs.org.
- **TypeScript global** vía `npm install -g typescript` o (su preferencia) `pnpm add -g typescript`.

Matt menciona **pnpm** como alternativa a npm — usa hard links a un store global en lugar de duplicar `node_modules` por proyecto. Más rápido, menos disco. Si tienes muchos proyectos JS, vale la pena migrar.

## Cómo se compara con nuestro setup

Nuestro [doc 01 — Runtime y ESM](../effectivetypescript/01-runtime-y-esm.md) y [doc 02 — tsconfig estricto](../effectivetypescript/02-tsconfig-strict.md) van más allá del setup que cubre Matt. Nosotros directamente:

- **No usamos `tsc` para emitir** — Node 22 con `--experimental-strip-types` corre los `.ts` directamente, sin build step.
- **No usamos `node_modules` globales** — todo es local al proyecto vía `npm` (no pnpm).
- **Asumimos** strict mode + ESM como punto de partida; Matt llega al strict tsconfig gradualmente.

Diferencias clave del setup del repo respecto a la receta clásica del capítulo:

| Pieza            | Capítulo Matt                | Nuestro repo                                       |
|------------------|------------------------------|----------------------------------------------------|
| Runtime          | Node + `tsc` emitiendo `.js` | Node 22 + `--experimental-strip-types` (sin emit)  |
| Package manager  | pnpm recomendado             | npm (consistencia con el ecosistema mainstream)    |
| Tooling adicional | (no cubre)                  | Biome (lint+format), tsx alternativa para emitir   |

> 💡 **Matt sale al mainstream**, nosotros salimos al **bleeding edge** (strip-types es Node 22, todavía experimental). Las dos rutas son válidas — la nuestra es más rápida pero acopla más al runtime; la suya es portable a cualquier setup.

## Ideas que merecen anotarse

### "TypeScript is for tooling"

Reformulación útil cuando alguien te dice "¿por qué TypeScript si Java/Rust son más estrictos?". La respuesta:

> TypeScript no compite con Rust en seguridad. Compite con JavaScript en *productividad de IDE*. Su único deber es **convertir JS en un lenguaje agradable para una codebase grande**. Por eso es estructural, por eso permite `any`, por eso aplana tantas excepciones de JS.

### El cliente más importante de TS es el editor

En consecuencia, **conocer los atajos del editor** te da más velocidad que dominar features oscuras del lenguaje. Lo profundiza el cap. 2.

### Versionado del compilador

Matt no entra mucho, pero merece la pena saber: TypeScript hace releases con cierta cadencia (~3 meses, version `X.Y`). Las **breaking changes en el sistema de tipos** son comunes — un código que pasa en TS 5.0 puede fallar en 5.4. Por eso el `typescript` debe estar en **devDependencies** con versión pineada (no `latest`).

En el repo: [services/node-api/package.json](../../services/node-api/package.json) tiene `"typescript": "^5.7.0"`.

## Ejercicio

1. **Confirma tu setup**: `node --version`, `tsc --version`, `code --version`. Compáralos con lo que el repo declara en `.nvmrc` y `package.json`. ¿Cuadran?

2. **VSCode usa la versión del workspace**: abre cualquier `.ts` del repo. En el statusbar inferior verás "TypeScript x.x.x". Click → "Use Workspace Version". Esto fuerza al editor a usar el `typescript` en `node_modules/`, no el global. Es la convención correcta — equipos donde unos tienen 5.7 y otros 5.4 en global empiezan a divergir.

3. **Lee el tooltip "hover"**: pon el cursor sobre `z.infer<typeof CreateUserSchema>` en `services/node-api/src/domain/user.ts`. El tooltip te muestra el tipo computado completo. Este es el "language server" en acción — sin él, TS sería casi inútil.

4. **`tsc --noEmit` en CI**: nuestro CI llama a `make node-typecheck` que internamente hace `tsc --noEmit`. Mira el output. ¿En qué se diferencia del que ves en VSCode mientras editas?

5. **Reto**: instala `pnpm` como prueba. Crea un proyecto vacío con `pnpm init`, instala `typescript`. Compara el tamaño de `node_modules` con un proyecto npm equivalente. ¿Migrarías el repo? ¿Qué te frenaría?

## 📖 Otros recursos

- [Anders Hejlsberg — Introducing TypeScript (2012)](https://channel9.msdn.com/posts/Anders-Hejlsberg-Introducing-TypeScript) — el video original donde se presenta el lenguaje. Histórico.
- [TypeScript release notes](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) — qué cambia en cada versión.
- [pnpm vs npm vs yarn](https://pnpm.io/motivation) — la motivación de pnpm en su propia voz.

---

**Anterior:** [00 — Introducción al track](./00-intro.md)
**Siguiente:** [02 — IDE Superpowers](./02-ide-superpowers.md)
