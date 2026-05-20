# 27 — API design y evolución de tipos

## El problema

Cuando publicas una librería, un módulo compartido o un paquete interno, tus **tipos son tu contrato**: lo que prometes hoy es lo que tus consumers escriben en su código. Romper ese contrato en una release menor te lleva a issues, builds rotos en CI ajenos, y la fama eterna de "esa lib que cambia la API sin avisar".

Pero los tipos también **necesitan evolucionar**: añades features, refactor naming, mejoras la precisión. No siempre puedes romper para mejorar — hay que saber qué cambios son seguros, cuáles requieren un major version bump, y cómo deprecar sin destrozar a quien aún no migró.

Este doc cubre:

- **Principios** de diseño para que los tipos aguanten cambios futuros.
- **Tabla de cambios**: cuáles son breaking, cuáles no.
- **Deprecation** con JSDoc `@deprecated` y aliases de transición.
- **Builder pattern y `this` types** — el patrón canónico de method chaining con tipos preservados.
- **Stable contracts**: separar la API pública de los internals para que tengas libertad de refactor.

## Principios para tipos que envejecen bien

### 1. Inputs amplios, outputs estrechos (Postel)

> Sé liberal en lo que aceptas, conservador en lo que produces.

Aplica directamente a tipos:

```ts
// ❌ input estrecho → cambiar a más amplio rompe NADA, pero el caller queda fragile
function pluralize(count: 1 | 2 | 3): string;

// ✅ input amplio → aceptas más, mantiene compat al ampliar
function pluralize(count: number): string;

// ❌ output amplio → estrechar luego es breaking (clients dependen del tipo viejo)
function getUser(): User | null | undefined;

// ✅ output estrecho → ampliar a U | V luego es breaking igualmente, pero al menos
//                     ahora pides menos garantías al consumer.
function getUser(): User | undefined;
```

Una regla derivada útil: **`readonly` en outputs**. Si devuelves un array mutable y el caller lo muta, has hecho promesa implícita de que esa mutación es segura. Mejor `ReadonlyArray<T>`.

```ts
export function listUsers(): readonly User[] { /* ... */ }
```

Cambiar de `User[]` a `readonly User[]` **es breaking** (callers que mutaban dejan de compilar). Empieza con `readonly` desde el día 1.

### 2. Discriminated unions resistentes a evolución

Recuerda doc 04 (`Result<T, E>`). El patrón con `kind` discriminante:

```ts
type Event =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'keypress'; key: string }
  | { kind: 'scroll'; delta: number };
```

**Añadir una variante** (`'hover'`) **es non-breaking**: los `switch` de los callers que olviden cubrirla rompen el `assertNever` exhaustive check (doc 18) — que es lo que **quieres**. Si en lugar de un discriminated union usaras un objeto con campos opcionales `{ kind: string; x?: number; key?: string; delta?: number }`, añadir un kind nuevo no rompería nada, pero **tampoco te avisaría** de que los callers olvidaron actualizarse.

> 💡 **Trade-off**: las uniones discriminadas son más estrictas → más segurididad pero más obras al evolucionar. Prefiere esto **a menos** que necesites extensibilidad por terceros (en cuyo caso, ver "Open vs closed" más abajo).

### 3. Default generic parameters para añadir flexibilidad sin breaking

```ts
// v1
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

// v2 — añade E con default, NO rompe consumers existentes
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

`Result<User>` sigue funcionando en v2 porque `E` cae al default. Nuevos callers pueden customizar: `Result<User, NotFoundError>`. **Añadir un parámetro genérico con default es non-breaking**.

### 4. Branded types para semántica permanente

Cubierto en doc 06 y revisitado en doc 24. El brand transmite información que un alias de tipo no puede:

```ts
// Frágil
function deleteUser(id: string) { /* ... */ }

// Estable: el caller no puede pasar un email accidentalmente
function deleteUser(id: UserId) { /* ... */ }
```

Una vez introducido el brand, **quitarlo es breaking** (los callers tienen que castear `id as UserId`). Pero el brand **previene errores tan caros** que vale la pena el coste de coordinación.

## Tabla de cambios: ¿breaking o no?

| Cambio                                                          | ¿Breaking? | Notas                                   |
|-----------------------------------------------------------------|------------|------------------------------------------|
| Añadir propiedad **opcional** a un input                        | ❌          | Callers existentes la omiten             |
| Añadir propiedad **requerida** a un input                       | ✅          | Callers tienen que poblarla              |
| Añadir propiedad a un output (interface/type)                   | ❌ usualmente | Pero ver "structural shift" abajo       |
| Eliminar propiedad de un input                                  | ❌          | Callers ya no la pasan; código que la usaba internamente sí cambia |
| Eliminar propiedad de un output                                 | ✅          | Callers que la leían rompen              |
| Estrechar tipo de input (`string` → `'a' \| 'b'`)               | ✅          | Callers con otros valores fallan        |
| Ampliar tipo de input (`'a' \| 'b'` → `string`)                  | ❌          | Más valores aceptados                    |
| Estrechar tipo de output (`unknown` → `User`)                   | ❌          | Más promesas, no menos                   |
| Ampliar tipo de output (`User` → `User \| null`)                | ✅          | Callers asumían que no era null         |
| Renombrar tipo exportado                                        | ✅          | Imports rotos. Mantén alias deprecated |
| Renombrar propiedad                                              | ✅          | A menos que añadas el nuevo + deprecates el viejo |
| Añadir generic parameter SIN default                            | ✅          | Callers con `Result<X>` necesitan especificar |
| Añadir generic parameter CON default                            | ❌          | Callers existentes no cambian            |
| Añadir variante a un discriminated union                        | ⚠️         | Non-breaking en JS; breaking si callers usan `assertNever` |
| Quitar variante de un discriminated union                       | ✅          | Callers que manejaban la variante rompen |
| Cambiar `User[]` a `readonly User[]`                             | ✅          | Callers que mutaban rompen               |
| Cambiar `readonly User[]` a `User[]`                             | ❌          | Más permisivo                            |
| Cambiar tipo concreto a interface                                | ❌ usualmente | Pero ojo con `instanceof` o duck-typing |
| `class A {}` → `class A<T = unknown> {}`                         | ❌          | Default es safety net                    |
| Cambiar campo `string` → `string \| undefined`                  | ✅          | Output ampliado                          |

**Regla unificadora**: cambios que **piden más** al consumer son breaking. Cambios que **piden menos** (o le entregan más) son seguros.

## Deprecation con JSDoc `@deprecated`

JSDoc `@deprecated` es **estándar TS-aware**: el LSP muestra el símbolo tachado en el editor y los compiladores opcionalmente warning. Sintaxis:

```ts
/**
 * @deprecated Use `findUserById` instead. Removed in v3.0.
 */
export function getUser(id: string): User { /* ... */ }

/**
 * @deprecated since v2.5 — `lastLoginAt` is replaced by `sessions[0].at`.
 *                          This field will be removed in v3.0.
 */
export type User = {
  id: string;
  email: string;
  lastLoginAt?: Date;
  sessions?: Session[];
};
```

VSCode y otros editores muestran:
- El símbolo con **línea tachada** en autocompletado.
- Una hint con el mensaje al hover.
- Una **diagnostic warning** si está configurado.

Patrón completo de deprecation graceful:

```ts
// v2.5 — añade el nuevo, deprecate el viejo
export interface User {
  id: string;
  email: string;
  /**
   * @deprecated since v2.5 — use `displayName` instead.
   * Will be removed in v3.0.
   */
  name?: string;
  displayName: string;
}

// v3.0 — borra el viejo (major bump)
export interface User {
  id: string;
  email: string;
  displayName: string;
}
```

Durante v2.x, ambos campos coexisten. Los callers viejos siguen funcionando. Los nuevos ven la warning y migran. En v3 se hace breaking limpio.

### Alias para renombrado sin romper

```ts
// v2 — renombrar UserDto a User. Old name kept as deprecated alias.
export interface User {
  id: string;
  email: string;
}

/** @deprecated since v2.0 — renamed to `User`. */
export type UserDto = User;
```

Imports viejos siguen compilando. Nuevos imports usan `User`.

## API surface area: separar público de interno

Cuando una librería crece, expones tipos pensados como internos sin querer. Esto es trampa: cualquier consumer que los importe se ata a tu interno. Cambias el interno → rompes al consumer.

### Patrón: barrel file con exports explícitos

```
src/
├── index.ts          ← public API. Solo re-exports de lo que es público.
├── public/
│   ├── client.ts     ← types públicos
│   └── result.ts
└── internal/
    ├── utils.ts      ← no se re-exporta
    └── parsers.ts
```

```ts
// src/index.ts — la API pública
export { Client, type ClientOptions } from './public/client';
export { type Result, ok, err } from './public/result';

// Internal modules: nunca aparecen en index.ts → no son parte de la API.
```

Convenciones complementarias:

- **Prefijo `_`** o **sufijo `Internal`** en tipos no-públicos.
- **`@internal` JSDoc tag** — herramientas como `api-extractor` lo respetan.
- **`/** @internal */`** + `--stripInternal` en `tsc` para emitir `.d.ts` sin esos símbolos.

### `package.json` `"exports"` map

En package publicado a npm, el `exports` field restringe **a nivel de bundler** qué paths son importables:

```json
{
  "name": "my-lib",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/public/client.js"
  }
}
```

Aunque `dist/internal/parsers.js` exista, `import 'my-lib/internal/parsers'` **falla** porque no está en el map. Esto es la línea de defensa más sólida — sin esto, los consumers pueden hacer `import { internalParser } from 'my-lib/internal/parsers'` y atarse a tu interno.

## `this` types y method chaining

El patrón fluent / builder en TS: cada método devuelve `this` para encadenar, **preservando el tipo concreto**.

```ts
class QueryBuilder {
  private filters: string[] = [];
  private orders: string[] = [];

  where(condition: string): this {     // ← clave: this, no QueryBuilder
    this.filters.push(condition);
    return this;
  }

  orderBy(field: string): this {
    this.orders.push(field);
    return this;
  }

  build(): string {
    return [
      'SELECT *',
      this.filters.length ? `WHERE ${this.filters.join(' AND ')}` : '',
      this.orders.length ? `ORDER BY ${this.orders.join(', ')}` : '',
    ].join(' ').trim();
  }
}

const q = new QueryBuilder()
  .where('age > 18')
  .orderBy('name')
  .build();
```

### Por qué `this` en lugar de `QueryBuilder`

Considera una subclase:

```ts
class AuditedQueryBuilder extends QueryBuilder {
  private auditedAt = Date.now();

  // Hereda where(), orderBy() — pero ¿qué tipo devuelven?
}

const aq = new AuditedQueryBuilder()
  .where('age > 18');                  // type: this → AuditedQueryBuilder ✅
//      ^ con `this` polymorphic preserva el tipo concreto

// Si where() devolviera QueryBuilder (no this):
//   .where(...).auditedAt  ❌ Property 'auditedAt' does not exist on QueryBuilder
```

`this` como return type es **polimórfico** — refiere al tipo concreto que se está construyendo. La subclase obtiene encadenado fluido sin reescribir todos los métodos.

### El builder pattern con state

Para builders donde el state cambia entre llamadas (ej. "después de llamar a `select` ya no se puede llamar a `select` otra vez"), `this` solo no basta. Necesitas tipos genéricos progresivos:

```ts
class QueryBuilder<S extends 'init' | 'selected' = 'init'> {
  // El tipo S avanza con cada operación
  select(this: QueryBuilder<'init'>, ...fields: string[]): QueryBuilder<'selected'> {
    /* ... */
  }

  where(this: QueryBuilder<'selected'>, condition: string): QueryBuilder<'selected'> {
    /* ... */
  }
}

new QueryBuilder()                    // state: 'init'
  .select('name', 'email')             // state: 'selected'
  .where('age > 18')                   // ✅ OK desde 'selected'
  .select('foo');                      // ❌ select requires state 'init'
```

Esto es **type-state programming**: el tipo de `this` codifica en qué fase del builder estás, y los métodos solo están disponibles desde estados válidos. Lo verás en libs como Drizzle ORM, knex, Prisma's client builder.

Es **potente** pero **caro**: a partir de 4-5 estados, los errores de TS son ilegibles para el usuario final. Reserva para APIs donde la complejidad lo justifica.

## Open vs closed types

Decisión deliberada: ¿quieres que los consumers **añadan variantes** a tus types?

```ts
// Closed (default, deseable casi siempre):
export type Event = ClickEvent | KeyPressEvent | ScrollEvent;

// Open (con declaration merging — doc 23):
export interface EventMap {
  click: ClickEvent;
  keypress: KeyPressEvent;
  scroll: ScrollEvent;
}

// Consumer puede extender:
declare module 'my-lib' {
  interface EventMap {
    'app:custom-event': MyCustomEvent;
  }
}
```

**Cuándo abrir**: cuando los consumers genuinamente necesitan registrar sus propios casos (handlers de eventos custom, command bus, dispatch tables). Spring usa esto extensivamente.

**Cuándo cerrar**: para casi todo. Los consumers se atan a tu set; tú controlas la evolución.

## Trampas comunes

1. **Re-exportar inadvertidamente con `export *`**:
   ```ts
   // index.ts
   export * from './internal/parsers';   // ❌ expone TODO el módulo interno
   ```
   Usa named exports explícitos: `export { specificFn } from './internal/parsers'`.

2. **Property addition "no-breaking" que en realidad rompe**:
   ```ts
   // v1
   type Plugin = { name: string };
   const allowed: Plugin = { name: 'x', extra: 'allowed' };  // ❌ excess property check, pero...

   // v2 — añades 'extra' al tipo
   type Plugin = { name: string; extra: string };
   const allowed: Plugin = { name: 'x' };                     // ❌ ahora 'extra' es required
   ```
   "Añadir field opcional" es non-breaking. "Añadir field requerido" sí rompe.

3. **Excess property checks vs structural compatibility**:
   ```ts
   type User = { id: string };
   const u: User = { id: '1', extra: 'x' };     // ❌ excess property check
   const fromVar = { id: '1', extra: 'x' };
   const u2: User = fromVar;                     // ✅ pasa porque viene de variable
   ```
   TS hace excess property checks **solo** en literal-to-type direct assignment. Esto es una optimización pragmática pero confunde: tu tipo no rechaza objects con más props si vienen de otro origen.

4. **Cambiar `interface` a `type` (o viceversa) en API pública**:
   - `interface` se puede aumentar con declaration merging; `type` no.
   - Si tus consumers están augmentando tu interface, cambiarla a `type` **rompe** sin que tú lo veas hasta runtime.
   - Conserva `interface` para tipos públicos que **puedan** ser augmentados; `type` para "datos cerrados".

5. **Tightening con generic defaults**:
   ```ts
   // v1
   type Storage<T = unknown> = { get(): T };
   // v2 — cambias el default
   type Storage<T = string> = { get(): T };
   ```
   Callers con `Storage` (sin `<T>`) ahora tienen `Storage<string>` en lugar de `Storage<unknown>`. **Es breaking**.

6. **`readonly` en interfaces vs in types**:
   ```ts
   interface User { readonly id: string }
   type AlsoUser = User;                  // hereda readonly
   const u: AlsoUser = { id: '1' };
   u.id = '2';                            // ❌ todavía readonly
   ```
   `readonly` se preserva. Pero a veces aliasing a un tipo "limpio" pierde annotations — verifica con type-level testing (doc 14).

7. **`@deprecated` sin contexto**:
   ```ts
   /** @deprecated */
   export function foo() { ... }
   ```
   Útil pero el caller queda mirando "OK, deprecated. ¿Y ahora qué?". **Siempre** incluye:
   - Desde qué versión.
   - Qué usar en su lugar.
   - Cuándo se elimina.

8. **`this` polimórfico en arrow functions** — no funciona:
   ```ts
   class Foo {
     where = (c: string) => {           // ❌ arrow → this es del enclosing scope
       return this;
     };
   }
   ```
   Usa `where(c: string): this { return this; }` (method syntax).

9. **Exportar tipos junto a values con el mismo nombre**:
   ```ts
   export class User { /* ... */ }
   // User es type Y value (constructor)

   export type User = { id: string };
   // colisión — declarations distintos del mismo nombre se confunden
   ```
   Si necesitas ambos, usa namespaces o convenciones (`UserType` vs `User` class).

10. **Cambios de inferencia que parecen seguros**:
    ```ts
    // v1
    function configure(opts: { url: string }) { return opts; }
    const c = configure({ url: 'x' });   // type: { url: string }

    // v2 — añades campo opcional
    function configure(opts: { url: string; debug?: boolean }) { return opts; }
    const c = configure({ url: 'x' });   // type: { url: string; debug?: boolean }
    ```
    Si algún caller hizo `const c: { url: string } = configure(...)`, ya no encaja exacto. Excess property checks. La inferencia cambió. Strictly speaking, **es non-breaking en la mayoría de casos** pero puede romper código defensivo.

## Ejercicio

1. **Audit del API pública del repo**: en `services/node-api/src/lib/result.ts`, lista los exports. ¿Cuáles son contractos públicos vs internos? ¿Hay algún `export *` que esté filtrando internals? Refactoriza para que `index.ts` sea explícito.

2. **Añade un campo opcional a `User`**: en `services/node-api/src/domain/user.ts`, añade `lastLoginAt?: Date` al schema Zod. Verifica con tests que el código existente sigue compilando sin cambios.

3. **`@deprecated` en práctica**: marca `findById` (con `Optional`) como `@deprecated`, recomendando `findByIdOrThrow`. Abre el archivo en VSCode y observa cómo aparece tachado en autocompletado.

4. **Builder con `this`**: implementa una clase `Query` con métodos `select`, `where`, `orderBy`, `limit` que retornen `this`. Crea una subclase `AuditedQuery` que añada `audit()`. Verifica que `new AuditedQuery().where(...).orderBy(...).audit()` funciona sin perder el tipo.

5. **Type-state programming**: refina el ejercicio 4 para que `select` solo se pueda llamar **antes** de `where`. Pista: parámetro genérico `S extends 'init' | 'selected'`.

6. **Open type extensible**: crea una `interface EventHandlers` con `click` y `keypress` predefinidos. Usa declaration merging para que un consumer añada `'app:save'` desde su propio módulo (doc 23 revisitado).

7. **Reto — Compatibility shim**: refactoriza un tipo legacy `OldUser` que tenía `name: string` al nuevo `User` con `displayName: string`. Mantén `OldUser` con un mapper que adapta automáticamente. Marca `OldUser` como `@deprecated`. Confirma que **el código antiguo sigue compilando** durante el grace period.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 30 — *Don't Repeat Type Information in Documentation*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/dont-repeat-types.md)** — coherencia entre tipos y JSDoc.
- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — naming que envejece bien.
- **[Item 51 — *Prefer Using Generics over Inheritance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/inheritance.md)** — base para builder pattern con `this`.
- **[Item 78 — *Bring Types into Sync with Implementation*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/sync.md)** — disciplina para que los tipos se mantengan honestos al refactorizar.

### Documentación y guías

- [TypeScript Design Guidelines](https://github.com/microsoft/TypeScript/wiki/Design-Goals) — los goals del propio compilador. La filosofía detrás del lenguaje.
- [TypeScript Handbook — Declaration Files Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html) — checklist canónica para diseñar `.d.ts`.
- [Microsoft API Extractor](https://api-extractor.com/) — herramienta para gestionar API surface area con `@internal`, `@beta`, `@public` tags.
- [TSDoc spec](https://tsdoc.org/) — el dialecto JSDoc estándar para TS, incluye `@deprecated`, `@remarks`, `@example`.

### Conceptual

- [Postel's law](https://en.wikipedia.org/wiki/Robustness_principle) — el principio "be liberal in what you accept, conservative in what you send". Aplicable a tipos.
- [Semver](https://semver.org/) — el contrato canónico de versiones. Aplica también a tipos.
- [Hyrum's law](https://www.hyrumslaw.com/) — "with a sufficient number of users, every observable behavior of your API will be depended on". Por eso `@deprecated` y grace periods importan.

---

**Anterior:** [26 — Async, `Promise<T>` y `Awaited<T>`](./26-async-promise-awaited.md)
**Siguiente:** *(fin del track TS avanzado — el repo continúa con el track [Total TypeScript Essentials](./totaltypescript/00-intro.md) en su propia carpeta)*
