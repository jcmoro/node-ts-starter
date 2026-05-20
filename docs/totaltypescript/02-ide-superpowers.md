# 02 — IDE Superpowers

> 📖 Capítulo original: [IDE Superpowers](https://www.totaltypescript.com/books/total-typescript-essentials/ide-superpowers)

## Qué cubre Matt

**Hueco real respecto a nuestro track**. Cubrimos la teoría pero nunca la práctica de cómo aprovechar el TypeScript Language Server desde el editor. Este capítulo es ~30 minutos bien gastados que pagan en productividad diaria.

Las features y atajos clave que recorre:

| Feature                          | Atajo (macOS / Win-Linux)            | Para qué                                                       |
|----------------------------------|--------------------------------------|----------------------------------------------------------------|
| Autocompletado disparado manual | `Ctrl + Space`                       | Filtrar sugerencias por prefijo. Útil cuando el auto no salta. |
| Hover (introspección)            | (pasar cursor) o `Ctrl + K, Ctrl + I` | Ver el tipo computado completo de cualquier identificador.    |
| Go To Definition                 | `F12` o `Cmd + Click`                | Saltar a dónde se declara un símbolo.                          |
| Go To References                 | `Shift + F12`                        | Listar todas las usages del símbolo en el repo.                |
| Rename Symbol                    | `F2`                                  | Renombrado type-aware: actualiza todas las referencias.        |
| Quick Fix / Refactor menu        | `Cmd + .` / `Ctrl + .`                | Acciones contextuales: extract constant, fix import, etc.      |
| Auto-import                      | (al elegir un símbolo no importado)  | Inserta el `import { ... } from '...'` automáticamente.        |
| Restart TS Server                | `Cmd + Shift + P` → "Restart TS Server" | Recuperarse de glitches del language server.                |

### Las ideas conceptuales

#### 1. Los "errores" de TS no son solo crashes

El compilador marca en rojo **dos categorías** distintas con la misma severidad visual:

- **Errores de runtime garantizados** — `null.foo()`, llamar a una función con tipo `undefined`. Estos sí crashearían en ejecución.
- **Violaciones de contrato** — pasar un `string` donde se esperaba un `'a' | 'b'`. El código compila a JS válido; lo que TS protesta es que el contrato del tipo no se cumple.

Distinguir mentalmente uno del otro ayuda al debugging:

> ¿Esto es un bug que crashearía sin TS, o es TS pidiéndome más rigor que JS?

#### 2. Lee los errores de multi-línea **de abajo arriba**

Cuando TS rechaza algo complicado (genéricos, conditional types), suelta una cascada de líneas. **La última línea** es la incompatibilidad fundamental. Las anteriores son el "path" desde tu código hasta el conflicto. Esto contradice el hábito normal de leer top-down — entrenar el orden inverso es 5 minutos que pagan para siempre.

#### 3. El hover **es exploración**

Pasar el cursor sobre `z.infer<typeof X>` y leer el tipo expandido **es más rápido** que abrir la definición. Es el equivalente de un REPL para tipos. Acostúmbrate a hover **mientras escribes**, no solo cuando algo se rompe.

#### 4. JSDoc enriquece el hover

```ts
/**
 * Validates and normalises an email at the system boundary.
 *
 * @param raw - the raw string from user input
 * @returns the normalised email or null if invalid
 * @example
 *   makeEmail('  JOSE@Example.com  ') // 'jose@example.com'
 */
export function makeEmail(raw: string): Email | null { ... }
```

Cuando otro dev haga hover sobre `makeEmail` ve **toda esa documentación** dentro del tooltip. Es la mejor manera de comunicar "cómo usar esto correctamente" sin obligarles a leer la implementación.

## Cómo se aplica al repo

### Audit de productividad sobre el repo

1. **Abre `services/node-api/src/app.ts`** y haz `F12` sobre cualquier referencia a `User`. Llegas a la entity. Haz `Shift + F12`: ves todos los sitios donde `User` se usa (controller, repositories, tests).

2. **Hover sobre `z.infer<typeof CreateUserSchema>`** en `domain/user.ts`. TS te muestra `{ email: Email; name: NonEmptyString }` — el tipo computado por Zod. Sin language server, tendrías que leer la implementación de Zod para entender qué te queda.

3. **Renombra `User.name` con F2** desde la entity. Mira el preview de cambios: incluye DTO, controller, service, tests. Cancela antes de confirmar — es solo para ver el alcance.

4. **`Cmd + .` sobre un símbolo no importado**. Por ejemplo, escribe `randomUUID()` en un archivo donde aún no esté importado de `node:crypto`. El editor te ofrece "Add import". Acepta.

5. **Quick Fix sobre un parámetro sin uso**: declara `function foo(a: string, b: number) { return a; }`. TS te dice que `b` no se usa. `Cmd + .` ofrece "Remove unused parameter".

## Cómo se compara con nuestro track

Nuestros docs nunca cubren atajos de editor — asumimos que cada dev los conoce. Este capítulo de Matt los sistematiza. **Recomendación**: léelo una vez y vuelve cuando el flow se ralentice.

Diferencia menor: Matt cubre VSCode primero. En JetBrains (WebStorm, IntelliJ con plugin TypeScript) los atajos son distintos pero los conceptos son los mismos. La tabla equivalente:

| Acción                | VSCode             | JetBrains          |
|-----------------------|--------------------|--------------------|
| Go To Definition      | `F12`              | `Cmd + B`          |
| Find Usages           | `Shift + F12`      | `Cmd + Alt + F7`   |
| Rename Symbol         | `F2`               | `Shift + F6`       |
| Quick Fix             | `Cmd + .`          | `Alt + Enter`      |
| Restart TS Server     | Command Palette    | Settings → restart |

## Ideas que merecen anotarse

### "El cliente principal de TS es el editor"

Reformulado del cap. 1. Aquí cobra sentido: si los tipos son para tooling, **dominar el tooling es dominar el lenguaje**. Un dev que conoce el lenguaje al dedillo pero no usa los atajos será siempre más lento que uno con menos conocimiento pero hábitos de editor sólidos.

### Hover-driven development

Práctica que algunos llaman así: en lugar de pensar "¿qué tipo es esto?", **hover y mira**. El sistema de tipos hace el trabajo. Ahorra el coste mental de mantener un modelo de los tipos en tu cabeza.

### `// @ts-ignore` vs `// @ts-expect-error`

Matt menciona los comentarios de supresión:

```ts
// @ts-ignore — suprime el error siguiente, sin verificación
// @ts-expect-error — suprime, pero exige que haya un error (si lo arreglas, el comentario protesta)
```

**Prefiere `@ts-expect-error`**. Te avisa cuando el problema se resuelve y el comentario ya sobra. `@ts-ignore` se queda silenciosamente y acumula deuda.

## Ejercicio

1. **Audit del statusbar**: en el inferior derecho de VSCode mientras editas un `.ts`, verifica que aparece "TypeScript x.y.z" — debe ser la versión del workspace (no la global). Si no, click → "Use Workspace Version".

2. **JSDoc útil en el repo**: añade un bloque JSDoc completo a `createUser` en `services/node-api/src/services/user-service.ts` con `@param`, `@returns`, y `@example`. Verifica el hover desde otra parte del código.

3. **F12 en una entity Spring**: si tienes el track Spring instalado, abre `services/spring-api/src/main/java/com/josemoro/api/users/UserController.java` y haz `F12` sobre `UserService`. Confirma que el plugin de Java funciona equivalente al TS Language Server.

4. **`Restart TS Server` en práctica**: edita `tsconfig.json` añadiendo un nuevo `paths` mapping. El IDE puede tardar en captarlo. `Cmd + Shift + P → Restart TS Server`. Verifica que ahora el nuevo path resuelve.

5. **Comparar `@ts-ignore` vs `@ts-expect-error`**: añade `@ts-ignore` a una línea con error. Luego arregla el error. Observa que el `@ts-ignore` queda mudo y sin sentido. Cámbialo por `@ts-expect-error` → ahora protesta que no hay error que suprimir.

## 📖 Otros recursos

- [VSCode — TypeScript Tips and Tricks](https://code.visualstudio.com/docs/typescript/typescript-tutorial) — referencia oficial.
- [Matt Pocock — YouTube shorts sobre el editor](https://www.youtube.com/@mattpocockuk) — buscar "VSCode" o "shortcut".
- [TypeScript Server protocol](https://github.com/microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29) — para los curiosos: cómo funciona internamente el language server.

---

**Anterior:** [01 — Kickstart Your TypeScript Setup](./01-kickstart-setup.md)
**Siguiente:** [03 — TypeScript In The Development Pipeline](./03-development-pipeline.md)
