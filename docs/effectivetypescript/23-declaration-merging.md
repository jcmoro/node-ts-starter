# 23 — Declaration merging y module augmentation

## El problema

TS tiene una propiedad que ningún lenguaje "serio" comparte: **dos `interface` con el mismo nombre se fusionan**. Lo que parece un error de novato es en realidad una feature deliberada con casos de uso concretos:

- **Extender tipos de librerías** sin tocar su código (ej. añadir un campo a `Request` de Express).
- **Crear modulos con valor y tipo** bajo el mismo nombre.
- **Componer tipos** desde múltiples ficheros sin re-exportar.

Esta es la herramienta que TS usa para hacer ergonómicas APIs que en otros lenguajes requerirían heredar, decorar o anotar manualmente.

## Lo básico — interfaces se fusionan

```ts
interface User {
  id: string;
}

interface User {
  email: string;
}

const u: User = {
  id: '1',
  email: 'jose@example.com',
}; // ✅ TS las une
```

Las dos declaraciones de `User` se **funden** en una sola: `{ id: string; email: string }`. Esto NO funciona con `type`:

```ts
type User = { id: string };
type User = { email: string }; // ❌ Duplicate identifier
```

Es la diferencia más importante entre `interface` y `type` en TS moderno. Casi todo lo demás (mapped types, unions, intersections) lo cubre `type`. La fusión es exclusiva de `interface`.

> 💡 **Comparación Java**: no existe. Una clase/interfaz se declara una vez. Lo más parecido sería `partial class` de C# — varias declaraciones en archivos distintos que se compilan como una.

### Reglas de fusión

1. **Propiedades que no chocan** → se unen.
2. **Métodos con el mismo nombre** → se interpretan como overloads.
3. **Propiedades con tipos distintos** → ❌ error.

```ts
interface Foo { x: number; }
interface Foo { x: string; } // ❌ Subsequent property declarations must have the same type
```

Para añadir variantes, usa uniones explícitas en una sola declaración.

## Module augmentation — extender librerías

El uso real más común. Imagina que Hono guarda un `userId` en el contexto via middleware y quieres tiparlo:

```ts
// src/types/hono.d.ts
import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    requestId: string;
  }
}
```

Y ahora:

```ts
app.use('*', async (c, next) => {
  c.set('userId', '123');  // ✅ TS sabe que userId es string
  c.set('foo', 42);        // ❌ Property 'foo' does not exist
  await next();
});

app.get('/me', (c) => {
  const id = c.get('userId'); // ✅ string
  return c.json({ id });
});
```

Mecánica:

1. **`declare module 'hono'`** abre el módulo `hono` para augmentar.
2. **`interface ContextVariableMap`** se fusiona con la `ContextVariableMap` de Hono.
3. Hono usa internamente `ContextVariableMap` para tipar `c.get()` y `c.set()`. Como la interface ahora tiene tus claves, el tipado las refleja.

### Patrón de declaration file

Coloca esto en un fichero `.d.ts` (no `.ts`):

```
src/
  types/
    hono.d.ts
    express.d.ts
```

Tres cosas críticas:

1. **El `import 'hono'`** al inicio convierte el archivo en un **módulo**. Sin él, las declaraciones serían globales — lo cual cambia completamente la semántica.
2. **`declare module`** se permite porque estás declarando un módulo externo, no implementándolo.
3. **`tsconfig.json`** debe incluir esos `.d.ts` (normalmente con `"include": ["src/**/*"]` ya entra).

### Casos típicos en este repo

```ts
// src/types/postgres.d.ts — añadir helpers a postgres.js
import 'postgres';

declare module 'postgres' {
  interface Helper<T> {
    debug(label: string): T;
  }
}
```

```ts
// src/types/node.d.ts — tipar process.env
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'staging' | 'production';
    DATABASE_URL: string;
    DATABASE_PATH?: string;
    PORT?: string;
  }
}
```

El segundo es **especialmente útil**. Por defecto `process.env.X` es `string | undefined` para cualquier `X`. Con augmentation, TS conoce las variables reales del proyecto y avisa si te dejas alguna.

> 💡 **Trampa**: augmentar `process.env` no **valida** que las variables existan en runtime — solo le dice a TS que confíe. La validación real la sigues haciendo con Zod al arrancar (`EnvSchema.parse(process.env)`).

### Augmentation y archivos globales

Si **omites** el `import` y declaras así:

```ts
// src/types/global.d.ts
declare global {
  interface Window {
    myApp: { version: string };
  }
}
```

`declare global` te deja modificar el namespace global. Cuidado: contamina **toda** la base de código. Reserva para casos donde realmente necesitas tipar algo global (browser polyfills, scripts inline).

## Namespace merging

Los `namespace` (antes "internal modules") también se fusionan. Útil para crear "módulos con valor + tipo":

```ts
function findUser(id: string) { /* ... */ }

namespace findUser {
  export type Result = { id: string; name: string };
  export const cache = new Map<string, Result>();
}

findUser('1');           // función
findUser.cache.set(...); // propiedad estática
const r: findUser.Result = { id: '1', name: 'Jose' }; // tipo
```

La función `findUser` y el namespace `findUser` se funden. Tienes una entidad que es **a la vez** función, container de propiedades, y namespace de tipos.

Patrón común para crear "factories con tipos asociados":

```ts
export function makeRepository<T>() {
  return {
    findById: async (id: string): Promise<T | null> => null,
  };
}

export namespace makeRepository {
  export type Repo<T> = ReturnType<typeof makeRepository<T>>;
}

// uso:
const userRepo = makeRepository<User>();
function inject(repo: makeRepository.Repo<User>) { /* ... */ }
```

> 💡 **Cuándo usar namespaces**: la regla moderna es **evítalos**. Para organización de código, usa módulos (archivos). Reserva namespaces para:
> - Augmentar libs (`declare namespace`).
> - Asociar tipos a una función exportada (como arriba).
> - Casos heredados que no quieres romper.

## Class merging

Las clases **no** se fusionan entre sí, pero sí pueden fusionarse con `interface` o `namespace`:

```ts
class User {
  id: string = '';
}

interface User {
  greet(): string; // método declarado, lo implementa otra cosa
}

namespace User {
  export const empty = new User();
}

const u = new User();
u.greet();      // ✅ existe en el type
User.empty;     // ✅ propiedad estática vía namespace
```

Esto se usa en patrones avanzados (mixins, jerarquías de plugins). Para código de aplicación normal, no hace falta.

## Cuándo usar declaration merging — y cuándo no

### Sí

- **Tipar campos añadidos al objeto Request/Context** de un framework (Express, Hono, Koa).
- **Tipar `process.env`** con las variables del proyecto.
- **Augmentar libs** que exponen interfaces extensibles (es **por diseño** suyo: si declaran `interface XConfig {}` en lugar de `type XConfig = {}`, te están invitando a extenderla).
- **Asociar tipos a una función** exportada (raro pero útil).

### No

- **Estructurar tu propio código**. Para tipos propios, usa `type` o `interface` en un solo sitio. Fusionar tipos propios complica el navegado.
- **Compensar diseño malo**. Si necesitas fusionar para parchear un tipo que no encaja, considera si la arquitectura está mal antes de meterte en augmentation.
- **Polyfilling silencioso**. Augmentar globals para "arreglar" tipos sin que el equipo sepa que existe el archivo genera confusión.

## Trampas comunes

1. **Olvidar el `import` en augmentation**:
   ```ts
   declare module 'hono' { ... } // ❌ se interpreta como módulo nuevo
   ```
   Sin un `import` arriba que convierta el archivo en módulo, el `declare module 'hono'` se trata como ambient declaration nueva, **no** como augmentation. Síntoma: tus tipos no aparecen. Solución: añade `import 'hono';` al principio.

2. **Tipos vs interfaces en augmentation**: solo puedes augmentar lo que la librería declaró como `interface` o `namespace`. Si declaró `type`, no puedes extender.

3. **Conflictos silenciosos**: dos archivos `.d.ts` que augmentan la misma interface con tipos incompatibles dan errores difíciles de rastrear. Centraliza las augmentations en un solo archivo por librería.

4. **`process.env` mentiroso**:
   ```ts
   declare namespace NodeJS {
     interface ProcessEnv {
       DATABASE_URL: string; // sin |undefined
     }
   }
   ```
   TS confía en que `DATABASE_URL` siempre existe. En runtime, si no la pasas, **será `undefined`** y crashearás. La augmentation no valida — sigue validando con Zod en el arranque.

5. **Module augmentation no funciona con import dinámico**:
   ```ts
   const hono = await import('hono'); // augmentation aplicada
   ```
   Sí funciona, pero la augmentation se aplica al tipo, no al objeto. Lo importas dinámicamente para code-splitting, no para escapar de los tipos.

6. **`declare global` contamina**: úsalo como último recurso. Si lo usas, documenta en un comentario por qué y dónde.

## Aplicado al repo — `process.env` tipado

Crea `src/types/env.d.ts`:

```ts
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV: 'development' | 'test' | 'staging' | 'production';
    readonly DATABASE_URL?: string;
    readonly DATABASE_PATH?: string;
    readonly PORT?: string;
    readonly LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  }
}
```

Ahora `process.env.NODE_ENV` tiene tipo literal — TS te avisa si comparas con `'prod'` (típico typo en lugar de `'production'`).

Pero **sigues validando con Zod** al arrancar (`src/config.ts`):

```ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_PATH: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = EnvSchema.parse(process.env);
```

Los dos juntos:
- **Augmentation** → tipos correctos cuando lees `process.env` directamente.
- **Zod** → validación runtime al arrancar; `env` deriva sus tipos del schema, **una sola fuente de verdad**.

## Ejercicio

1. **Augmentar Hono Context**: crea `src/types/hono.d.ts` y añade `userId: string` y `requestId: string` a `ContextVariableMap`. En un middleware, pon `c.set('requestId', crypto.randomUUID())`. Comprueba que `c.get('requestId')` tiene tipo `string` y no `unknown`.

2. **Tipar `process.env`**: crea `src/types/env.d.ts` con todas las variables que usa el repo. Comprueba que TS detecta cuando comparas `process.env.NODE_ENV === 'prod'` (typo).

3. **Augmentación que falla**: omite el `import 'hono'` en el archivo del ejercicio 1. ¿Qué pasa? Investiga por qué los tipos no aplican. Lee el error de compilación si lo hay.

4. **Namespace + función**: implementa `function user(name: string): User` y un namespace `user` con un tipo `user.Created` y una constante `user.SYSTEM`. Comprueba que la sintaxis funciona.

5. **Reto — augmentation tipada con keyof**: augmenta `ContextVariableMap` de Hono con N claves leídas de un schema Zod. Pista: `z.infer<typeof Schema>` + mapped types del doc 21.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 13 — *Know the Differences Between `type` and `interface`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/type-vs-interface.md)** — la base. Sin entender la diferencia, no captas por qué fusionar es exclusivo de interface.
- **[Item 79 — *Test Your Type Declarations*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/test-declarations.md)** — verificar que tu augmentation no rompe nada (relacionado con el doc 14, type-level testing).
- **[Item 82 — *Avoid Spreading `any`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/avoid-any-spread.md)** — qué evitar al diseñar interfaces extensibles públicas.

---

**Anterior:** [22 — Overloads y `satisfies`](./22-overloads-y-satisfies.md)
**Siguiente:** [24 — `Symbol` y `unique symbol`](./24-symbol-y-unique-symbol.md)
