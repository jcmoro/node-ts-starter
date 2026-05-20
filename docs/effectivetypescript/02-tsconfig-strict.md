# 02 — tsconfig estricto

## El problema

TypeScript es **configurable hasta lo absurdo**. Por defecto (sin flags) es casi un linter laxo: deja `any` implícito, permite acceso a propiedades que no existen, ignora `null`/`undefined`… Para alguien que viene de Java o Go, ese TS "por defecto" se siente como mentir sobre los tipos.

La buena noticia: el `tsconfig.json` del proyecto está configurado **al máximo de estricto razonable**. La mala: hay como 15 flags y ninguno se explica solo. Este capítulo es el manual de cada uno.

## El `tsconfig.json` del proyecto

Abre `tsconfig.json` y léelo en paralelo. Vamos por bloques.

---

### Bloque 1 — Target y módulos

```json
"target": "ES2023",
"lib": ["ES2023"],
"module": "NodeNext",
"moduleResolution": "NodeNext",
"moduleDetection": "force",
```

- **`target`** — versión de JS a la que se compilaría (en build). `ES2023` incluye `Array.prototype.findLast`, `toSorted`, etc. Como Node 22 soporta ES2024, podrías subir, pero ES2023 es seguro.
- **`lib`** — qué tipos del runtime están disponibles. Por defecto incluye `DOM` (browser). Como esto es Node, lo quitamos.
- **`module: NodeNext`** — usa el sistema de módulos de Node moderno (ESM con detección por `package.json`). Es el correcto cuando tienes `"type": "module"`.
- **`moduleResolution: NodeNext`** — cómo se resuelven los imports. Pareja obligada de `module`.
- **`moduleDetection: force`** — fuerza que **todo `.ts` se trate como módulo**, aunque no tenga `import`/`export`. Esto evita el modo "script" antiguo donde las variables top-level eran globales. **Recomendación**: déjalo siempre en `force`.

> 💡 **Analogía Java**: piensa en `target`/`lib` como el `pom.xml` declarando `<source>` y `<target>` JDK version. `module` es el sistema de paquetes.

---

### Bloque 2 — Strict mode y sus extras

```json
"strict": true,
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
"noPropertyAccessFromIndexSignature": true,
"exactOptionalPropertyTypes": true,
```

#### `strict: true`

Es un meta-flag que activa siete chequeos a la vez. Los más importantes:

- **`noImplicitAny`** — si TS no puede inferir un tipo, fallar en vez de asignar `any`.
- **`strictNullChecks`** — `null` y `undefined` **no son** asignables a otros tipos. Tienes que distinguirlos. Esto es el cambio mental más grande para quien viene de Java (donde todo objeto puede ser `null`) o de Go (donde solo punteros lo son).
- **`strictFunctionTypes`** — varianza correcta en parámetros de función.
- **`strictBindCallApply`** — `bind`/`call`/`apply` tipan los argumentos.

En la práctica: **siempre activado**. Si lo desactivas, no estás escribiendo TypeScript, estás escribiendo JS con type hints.

#### `noUncheckedIndexedAccess`

```ts
const arr: string[] = ['a', 'b'];
const x = arr[0]; // sin el flag: string. Con el flag: string | undefined
```

Cualquier acceso por índice (arrays, objetos con index signature, `Record<K, V>`) devuelve `T | undefined`. Esto refleja la realidad: el índice puede no existir.

**Por qué importa**: es exactamente la clase de bug que `strictNullChecks` no captura por defecto. Sin este flag, TS asume que todo índice es válido — y a las 4 de la mañana en producción, no lo es.

> 💡 **Analogía Go**: `m, ok := myMap[key]` — siempre te obliga a comprobar `ok`. TS no llega tan lejos (no hay tuple-return), pero el `| undefined` cumple la misma función: te obliga a narrow antes de usarlo.

#### `noImplicitOverride`

```ts
class Base { greet() {} }
class Child extends Base {
  greet() {}           // ❌ debe llevar 'override'
  override greet() {}  // ✅
}
```

Como `@Override` en Java, pero obligatorio. Previene el bug clásico: renombras el método en `Base`, los hijos siguen con el nombre viejo y "funcionan" sin sobrescribir nada.

#### `noFallthroughCasesInSwitch`

```ts
switch (x) {
  case 'a':
    doA();
    // ❌ falta break/return
  case 'b':
    doB();
    break;
}
```

> 💡 **Analogía Go**: en Go el `switch` no tiene fallthrough por defecto y necesitas `fallthrough` explícito. TS, con este flag, llega a lo mismo: si quieres caer al siguiente case, hazlo obvio (en TS, omitiendo el `break` y añadiendo un comentario `// fallthrough` que el flag detecta como excepción).

#### `noPropertyAccessFromIndexSignature`

```ts
const obj: { [key: string]: number } = {};
obj.foo;     // ❌
obj['foo'];  // ✅
```

Si declaras un index signature, no puedes acceder con `.dot`. Te obliga a usar `[]`, lo cual deja claro en el código "este acceso es dinámico, podría no existir".

#### `exactOptionalPropertyTypes`

Sin este flag:

```ts
type User = { name?: string };
const u: User = { name: undefined }; // ✅ pasa
```

Con el flag:

```ts
const u: User = { name: undefined }; // ❌
const u2: User = {};                  // ✅
const u3: User = { name: 'Jose' };    // ✅
```

TS distingue **"la propiedad no existe"** de **"existe con valor undefined"**. Si vienes de JS, donde `obj.x === undefined` para ambos casos, esto se siente raro al principio.

**Por qué importa**: cuando serializas a JSON, `{ name: undefined }` se convierte en `{}` (la clave desaparece). El flag te fuerza a ser explícito sobre la diferencia.

---

### Bloque 3 — Módulos y type-only

```json
"allowImportingTsExtensions": true,
"verbatimModuleSyntax": true,
"isolatedModules": true,
"esModuleInterop": true,
"resolveJsonModule": true,
"skipLibCheck": true,
"forceConsistentCasingInFileNames": true,
```

#### `allowImportingTsExtensions`

```ts
import { env } from './env.ts'; // permitido
```

Sin esto, TS exige `./env` (sin extensión) o `./env.js`. Como usamos type-stripping, queremos la extensión `.ts` real. Va parejo con `noEmit: true` (sin emitir, no hay riesgo de que el `.ts` quede en la salida).

#### `verbatimModuleSyntax`

Obliga a marcar como `import type` (o `export type`) cualquier cosa que **solo se use en tipos**.

```ts
import type { Env } from './env.ts';  // ✅ solo tipo
import { env } from './env.ts';        // ✅ valor
import { env, type Env } from './env.ts'; // ✅ mixto
```

Sin esto, TS borraba los imports type-only automáticamente al compilar. Con esto, **no transforma nada** — lo que escribes es lo que se ejecuta. Esto es **requisito** para que strip-types funcione correctamente.

#### `isolatedModules`

Cada archivo debe poder compilarse **de forma independiente**. Esto descarta features que necesitan análisis cross-file (algunos `const enum`, ciertos re-exports). Es requisito para herramientas como esbuild, swc o el propio strip-types.

#### `esModuleInterop`

Permite hacer `import X from 'cjs-module'` con módulos CommonJS que no tienen `default` export. Calidad de vida, déjalo activado.

#### `resolveJsonModule`

Puedes hacer `import data from './data.json'` y TS lo tipa.

#### `skipLibCheck`

No type-checkea los `.d.ts` de `node_modules`. Acelera mucho la compilación y evita errores en librerías de terceros que no controlas. **Estándar de facto**: déjalo siempre activado.

#### `forceConsistentCasingInFileNames`

Si importas `./User.ts` pero el archivo es `./user.ts`, falla. macOS y Windows tienen filesystems case-insensitive — sin este flag, el proyecto rompería en Linux/CI.

---

### Bloque 4 — Output

```json
"noEmit": true,
"sourceMap": true,
"declaration": false,
```

- **`noEmit: true`** — `tsc` no genera archivos. Sólo type-checkea. Lo correcto en este setup, porque el build real lo hace `tsconfig.build.json` y la ejecución la hace Node directamente.
- **`sourceMap`** — útil para debugging (mapea de JS a TS en el stack trace).
- **`declaration: false`** — no genera `.d.ts` en el config base. El de build sí los genera.

---

### Bloque 5 — Paths

```json
"baseUrl": ".",
"paths": {
  "#/*": ["src/*"]
}
```

Permite escribir `import { env } from '#/env.ts'` en vez de calcular rutas relativas. **Cuidado**: `paths` lo entiende `tsc`, pero **no Node**. Para que funcione en runtime con strip-types necesitas:

- O bien la convención `#/` (con almohadilla), que Node soporta nativamente como [subpath imports](https://nodejs.org/api/packages.html#subpath-imports) si está declarada en `package.json["imports"]`.
- O un loader que resuelva los aliases.

En este proyecto está la línea en `paths` pero **aún no la usamos**. Cuando la activemos, añadiremos también la entrada en `package.json["imports"]`.

---

## El `tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "allowImportingTsExtensions": false,
    "declaration": true
  },
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

¿Por qué un segundo config? Porque las opciones de **dev** (no emit, permitir `.ts` en imports) chocan con las de **build** (emit a `dist/`, las extensiones tienen que ser `.js` reales).

La forma idiomática en TS es **un config base y configs especializados que extienden**, en lugar de un único config con condicionales.

---

## Comparación con otros lenguajes

| Concepto en TS                | Equivalente aproximado                              |
|-------------------------------|-----------------------------------------------------|
| `strict: true`                | `-Wall -Werror` en C, todos los linters en Go       |
| `noUncheckedIndexedAccess`    | El `, ok` pattern de Go en mapas                    |
| `strictNullChecks`            | `Optional<T>` de Java, sin `null` implícito         |
| `exactOptionalPropertyTypes`  | Distinción que en otros lenguajes no existe         |
| `verbatimModuleSyntax`        | "Erased" generics de Java, pero explícito           |

---

## Trampas comunes

1. **Activar `strict` y rendirse al primer error.** El primer día de strict mode es doloroso. El segundo, normal. El tercero, no entiendes cómo programabas sin él.
2. **Confundir "tipa" con "valida en runtime".** El tsconfig más estricto del mundo no valida un JSON entrante. Para eso, capítulo 03 (Zod).
3. **Poner `"strict": false` y compensar con flags individuales.** Mala idea. Mejor `"strict": true` y desactivar el flag concreto que te molesta (raramente necesario).
4. **Asumir que `noUncheckedIndexedAccess` se aplica a propiedades nombradas.** No. `const x: { a: number } = { a: 1 }; x.a` sigue siendo `number`, no `number | undefined`. Solo se aplica a accesos indexados (array/Record).

---

## Ejercicio

1. Abre `src/index.ts`. En el handler de `/users`, después del `safeParse`, añade:
   ```ts
   const first = parsed.data.name[0]; // primer carácter
   console.log(first.toUpperCase());
   ```
   `tsc --noEmit` debería quejarse. ¿Por qué? ¿Cuál es el tipo de `first`?

2. Arregla el error de dos formas:
   - Con un guard: `if (first) { ... }`.
   - Con `parsed.data.name.charAt(0)` (devuelve `string`, no `string | undefined`).

   Discute mentalmente cuál prefieres y por qué.

3. Quita `noUncheckedIndexedAccess` del `tsconfig.json` y observa que el error desaparece. Vuelve a activarlo.

4. Crea un archivo `src/scratch.ts`:
   ```ts
   type Maybe = { value?: number };
   const a: Maybe = { value: undefined };
   ```
   Con `exactOptionalPropertyTypes`, esto debería fallar. ¿Qué dice el error? ¿Cómo lo arreglas?

   Borra el archivo cuando termines (es solo para experimentar).

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 2 — *Know Which TypeScript Options You're Using*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-intro/which-ts.md)** — el item meta de tsconfig. Defiende exactamente la mentalidad de "activa strict y conoce cada flag" que aplicamos aquí.
- **[Item 11 — *Distinguish Excess Property Checking from Type Checking*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/excess-property-checking.md)** — el mecanismo que hace que `exactOptionalPropertyTypes` te marque `{ name: undefined }` como inválido en object literals.
- **[Item 14 — *Use `readonly` to Avoid Errors Associated with Mutation*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/readonly.md)** — el siguiente paso natural después de tener un tsconfig estricto.
- **[Item 22 — *Understand Type Narrowing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/narrowing.md)** — cómo `noUncheckedIndexedAccess` te empuja a hacer narrow antes de usar valores que pueden ser `undefined`.
- **[Item 83 — *Don't Consider Migration Complete Until You Enable `noImplicitAny`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-migrate/start-loose.md)** — el destino del migration journey. Si vinieras de un proyecto JS, así llegarías a nuestro tsconfig.

---

**Anterior:** [01 — Runtime y ESM](./01-runtime-y-esm.md)
**Siguiente:** [03 — Validación con Zod](./03-validacion-con-zod.md)
