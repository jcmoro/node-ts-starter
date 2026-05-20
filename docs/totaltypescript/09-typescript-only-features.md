# 09 — TypeScript-only Features

> 📖 Capítulo original: [TypeScript-only Features](https://www.totaltypescript.com/books/total-typescript-essentials/typescript-only-features)

## Qué cubre Matt — HUECO PARCIAL

Las features que **TS añade sobre JavaScript estándar** — sintaxis que solo existe en TS y desaparece (o cambia) al transpilar a JS:

1. **Parameter properties** (las cubrimos en cap. 8, Matt las repasa aquí).
2. **Enums** — numéricos, string, `const enum`, sus quirks.
3. **Namespaces** — el sistema pre-ES6 de organización, casi obsoleto.
4. **Cuándo preferir ES vs TS-only** — la postura filosófica de TS moderno.

> ⚠️ **No cubre decorators**. A pesar de lo que el título sugiere, decorators no están en este capítulo del libro. Para decorators, mira la doc oficial o el curso advanced de Matt.

## Lo que importa

### Enums — el feature controvertido

```ts
// Numeric enum (default)
enum Status {
  Pending,    // = 0
  Approved,   // = 1
  Rejected,   // = 2
}

// String enum
enum Region {
  EU = 'eu',
  US = 'us',
  AP = 'ap',
}

// Const enum (inlined at compile time)
const enum LogLevel {
  Debug,
  Info,
  Warn,
  Error,
}
```

**Los tres tienen comportamientos sutilmente distintos:**

| Feature                  | Numeric enum    | String enum     | const enum   |
|--------------------------|-----------------|-----------------|--------------|
| Transpilado a JS         | Object con reverse-mapping | Object simple | **Inlined** (desaparece) |
| Nominal o estructural    | Estructural     | **Nominal** (raro en TS) | Inlined value |
| Iteración                | ✅ con quirk    | ✅              | ❌            |
| Bundle size              | Más alto        | Medio           | **Cero**      |
| Funciona con `isolatedModules` | ✅       | ✅              | ❌            |

### Los quirks de los enums numéricos

```ts
enum Status { Pending, Approved, Rejected }

Status.Pending;        // 0
Status[0];             // 'Pending' — reverse mapping!
Status[99];            // undefined — pero TS no protesta
const s: Status = 99;  // ✅ TS lo acepta — cualquier number cabe
```

Es decir: **los enums numéricos no son safe**. Cualquier `number` se acepta en una variable typed como `Status`. El reverse mapping añade más entries al object en runtime.

### Los string enums son raros — nominales

```ts
enum Region { EU = 'eu' }

const r1: Region = 'eu';        // ❌ — string literal NO es asignable a Region
const r2: Region = Region.EU;    // ✅
```

Esto contradice el resto de TS, que es estructural (un string que parezca `'eu'` debería valer). Los string enums son **deliberadamente nominales** — Matt y muchos otros lo ven como anti-patrón en un sistema que es estructural en todo lo demás.

### `as const` arrays — la alternativa moderna

```ts
const STATUS = ['pending', 'approved', 'rejected'] as const;
type Status = typeof STATUS[number];   // 'pending' | 'approved' | 'rejected'

const s: Status = 'pending';            // ✅ — natural, estructural
STATUS.forEach(...);                    // ✅ — iterable real

// Bonus: tree-shakeable, sin runtime overhead
```

Ventajas vs enums:
- **Estructural** (consistente con el resto de TS).
- **Iterable nativo** (el array existe en runtime).
- **Tree-shakeable** (es un const, no un object con reverse-mapping).
- **Sin import dance** (no necesitas importar el "valor" del enum; usas literal strings).

Matt y nuestra recomendación: **`as const` arrays sobre enums** en código nuevo. Solo usa enums si:
- Trabajas en una codebase legacy que ya los usa (consistencia).
- Necesitas la sintaxis específica de enums para alguna lib (raro).

### Namespaces — legacy desde ES2015

```ts
namespace Validation {
  export interface StringValidator { isAcceptable(s: string): boolean }
  export class LettersValidator implements StringValidator { ... }
}
```

Pre-ES6, JS no tenía módulos. Namespaces eran la solución de TS para evitar global pollution. **Desde 2015 con ES modules, son obsoletos** para casi todo:

```ts
// Equivalente moderno con módulos
export interface StringValidator { ... }
export class LettersValidator { ... }
// Import: import * as Validation from './validation';
```

**Cuándo namespaces siguen siendo válidos**:
- Declaration merging (cubierto en [doc 23](../effectivetypescript/23-declaration-merging.md)) — augmentar libs como `Express.Request`.
- Asociar tipos a una función exportada (raro):
   ```ts
   export function find(id: string): User { ... }
   export namespace find { export type Result = User | null; }
   ```

Para todo lo demás, módulos ES.

## Cómo se compara con nuestro track

- **Enums**: nuestro [doc 06 ampliado](../effectivetypescript/06-branded-types.md) mostró el patrón `as const` array para enums. Esta es la práctica idiomática.
- **Namespaces**: cubierto en [doc 23 — Declaration merging](../effectivetypescript/23-declaration-merging.md), donde son la herramienta legítima para `declare global { namespace NodeJS { interface ProcessEnv ... } }`.
- **Decorators**: nuestro track no los cubre. El curso advanced de Matt (de pago) sí. Para producción: si usas NestJS, MikroORM, class-validator, los aprenderás en su contexto.

## Ideas que merecen anotarse

### "TypeScript should be JS with types"

La filosofía moderna (especialmente desde TS 5.x) es **NO añadir features runtime que JS no tenga**. Los enums son de la primera época de TS, cuando JS aún era inmaduro. Hoy:

- Decorators son **standard ECMAScript** (TC39 stage 3), no TS-specific.
- Modules son ES standard.
- `??`, `?.`, top-level await son JS.

Las únicas features TS-only que aún viven sin equivalente JS:
- Tipos y anotaciones (obvio).
- `as` assertions.
- Enums (controversial, "should-have-been-only-a-type" según muchos).
- Namespaces (legacy).
- Parameter properties (azúcar puro).

### Reverse mapping de numeric enums — gotcha clásico

```ts
enum Status { Pending, Approved, Rejected }

console.log(Object.keys(Status));
// ['0', '1', '2', 'Pending', 'Approved', 'Rejected']

console.log(Object.values(Status));
// ['Pending', 'Approved', 'Rejected', 0, 1, 2]
```

`Object.keys(numericEnum)` devuelve **el doble** de lo que esperas. Para iterar sobre los miembros, filtra:

```ts
Object.values(Status).filter(v => typeof v === 'string');  // ['Pending', 'Approved', 'Rejected']
```

String enums no tienen este problema. Otra razón para preferir `as const` arrays.

### `const enum` ban en muchos build tools

```ts
const enum Color { Red, Green, Blue }
```

Esto **funciona con `tsc` clásico** pero **falla con build tools que no hacen type checking** (Vite, esbuild, swc, ts-loader sin `transpileOnly: false`). Razón: `const enum` requiere que el bundler conozca el tipo para hacer inlining, y muchos bundlers no lo hacen.

Si usas `const enum` y migras a Vite/esbuild, **te encontrarás con errores raros**. Es la razón por la que muchos linters tienen una regla "no-const-enum".

## Ejercicio

1. **Refactor enum → `as const` array**: si encuentras algún `enum` en `services/node-api/` (probablemente no, pero check), migra a `const X = [...] as const` + `type X = typeof X[number]`. Mide el tamaño del bundle antes y después.

2. **Verifica el reverse mapping**: en un script aparte:
   ```ts
   enum Status { Pending, Approved }
   console.log(Object.keys(Status));   // doble
   ```
   ¿Te sorprende? Anota esta gotcha.

3. **String enum vs literal union**:
   ```ts
   enum Region { EU = 'eu' }
   type Region2 = 'eu' | 'us' | 'ap';
   ```
   Compara la asignabilidad: `const a: Region = 'eu'` (¿compila?), `const b: Region2 = 'eu'` (¿compila?). El comportamiento explica por qué los string enums son raros.

4. **Namespaces — declaration merging válido**: en `services/node-api/src/types/env.d.ts` (créalo) define un namespace augmentando `NodeJS.ProcessEnv` para que `process.env.DATABASE_URL` tenga tipo `string | undefined` específico. Cubierto en detalle en [doc 23](../effectivetypescript/23-declaration-merging.md).

5. **Reto — `const enum` ban**: añade `"isolatedModules": true` a tu tsconfig (ya lo tienes en el repo) e intenta usar `const enum`. ¿Qué error sale? Lee la mensajería.

## 📖 Otros recursos

- [TypeScript Handbook — Enums](https://www.typescriptlang.org/docs/handbook/enums.html) — la referencia oficial.
- [Matt Pocock — "Don't use enums, use ... this"](https://www.youtube.com/results?search_query=matt+pocock+typescript+enums) — varios shorts sobre el tema.
- [Effective TypeScript — Item 53: Know How to Iterate over Objects](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/iterate-objects.md) — el gotcha de `Object.keys` con enums entra aquí.
- [TC39 Decorators proposal](https://github.com/tc39/proposal-decorators) — el spec de los decorators standard (estable, no TS-specific).

---

**Anterior:** [08 — Classes](./08-classes.md)
**Siguiente:** [10 — Deriving Types](./10-deriving-types.md)
