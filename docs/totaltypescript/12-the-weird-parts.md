# 12 — The Weird Parts

> 📖 Capítulo original: [The Weird Parts](https://www.totaltypescript.com/books/total-typescript-essentials/the-weird-parts)

## Qué cubre Matt — HUECO REAL

Comportamientos extraños y contraintuitivos del compilador que sorprenden incluso a devs experimentados. **No es un capítulo que enseña features — es un capítulo que te ahorra horas de "qué demonios"**.

Las gotchas:

1. **Evolving `any`** — variables sin annotation explícita que cambian de tipo dinámicamente.
2. **Excess property checks** inconsistentes según contexto.
3. **`Object.keys` devuelve `string[]`**, no `keyof T`.
4. **`{}` es "anything except null/undefined"**, no "empty object".
5. **Type space vs Value space** — el mismo identificador puede vivir en los dos.
6. **`this` en functions** vs arrow functions.
7. **Function assignability** — los argumentos contravariantes y por qué TS acepta funciones con menos params.

## Las 7 weird parts en detalle

### 1. Evolving `any`

```ts
let x;          // sin annotation
x = 'hello';    // type: string
x = 42;          // type: number
x.toUpperCase();  // ❌ — x ahora es number
```

Sin annotation, TS empieza con `any` implícito (si `noImplicitAny: false`) o el inferenced del primer assign. Con `noImplicitAny: true` (nuestro tsconfig), `let x;` da error o se infiere desde el primer use.

**Truco con arrays**:

```ts
const arr = [];   // type: any[]
arr.push('hello');
arr.push(42);
arr;              // type: (string | number)[] ← evolución
```

El array empieza como `any[]` y va "creciendo" su tipo. Con strict mode esto se vuelve `never[]` por defecto, evitando el behavior raro.

### 2. Excess property checks inconsistentes

```ts
type User = { name: string };

// ❌ Excess property check ON
const u: User = { name: 'a', extra: 'b' };

// ✅ Excess property check OFF (porque va vía variable)
const data = { name: 'a', extra: 'b' };
const u2: User = data;
```

TS aplica excess checks **solo en literal-to-type direct assignment**. Cualquier indirección (variable, function arg via variable) y el check se desactiva. Es una **optimización pragmática** — TS dice "objects son abiertos por defecto" estructuralmente, pero en literales aplica el check como cortesía a typos.

Esto sorprende: esperas que `{ name: 'a', extra: 'b' }` siempre falle contra `User`, pero no.

### 3. `Object.keys` devuelve `string[]`

```ts
type User = { id: string; email: string };
const u: User = { id: '1', email: 'a@b.com' };

Object.keys(u);   // string[] — NO ('id' | 'email')[]
```

Razón: `User` es estructural — cualquier object con `{ id, email }` (y posiblemente más) es asignable. `Object.keys` puede devolver claves extras a runtime. TS no asume keys exactas.

Workaround:

```ts
(Object.keys(u) as (keyof User)[]).forEach((k) => u[k]);
```

Cast forzoso. Cubierto en [doc 25](../effectivetypescript/25-index-signatures-y-record.md). Es **idiomático** aunque feo.

### 4. `{}` no es "empty object"

```ts
const a: {} = 'hello';     // ✅ — sorprendentemente válido
const a: {} = 42;          // ✅
const a: {} = { x: 1 };    // ✅
const a: {} = null;        // ❌
const a: {} = undefined;   // ❌
```

`{}` significa **"cualquier non-nullish value"** — no "objeto vacío". Para "objeto genérico", usa `Record<string, unknown>` o `object`.

### 5. Type space vs Value space — el mismo nombre, dos identidades

```ts
class User { ... }
//    ^^^ User es Type (la interfaz inferida) Y Value (el constructor)

enum Status { Pending }
//   ^^^^^^ Status es Type Y Value (el objeto con reverse mapping)

const User = ...;
type User = ...;
//    ^^^ El mismo nombre puede vivir como Type y Value simultaneously
```

Cuando importas:

```ts
import { User } from './user';        // importa ambos (type + value)
import type { User } from './user';   // solo el type
import { type User } from './user';   // solo el type (sintaxis inline, TS 4.5+)
```

Crítico para `verbatimModuleSyntax: true` (activo en nuestro repo) — TS exige que separes las dos formas.

### 6. `this` en functions vs arrow

```ts
const obj = {
  name: 'Jose',
  greetFn: function () { return `Hi, ${this.name}` },    // this dynamic
  greetArrow: () => `Hi, ${this.name}`,                   // this lexical (outer scope!)
};

obj.greetFn();           // 'Hi, Jose'
obj.greetArrow();        // 'Hi, undefined' (this es el módulo, no obj)

const detached = obj.greetFn;
detached();               // TypeError — this es undefined
```

Reglas:
- **`function` declarations**: `this` es **dinámico** — depende de cómo se llama. `obj.fn()` → `this = obj`. `fn()` → `this = undefined` (strict).
- **Arrow functions**: `this` es **léxico** — captura el `this` del scope envolvente.

**Tipar `this` explícitamente** (TS-only feature):

```ts
function greet(this: { name: string }): string {
  return `Hi, ${this.name}`;
}

const obj = { name: 'Jose' };
greet.call(obj);   // ✅
greet();            // ❌ — falta this
```

`this` como primer parámetro (con nombre `this`, especial) es una anotación pura — no aparece en runtime, no cuenta para `.length`.

### 7. Function assignability — menos parámetros está OK

```ts
function takesTwo(a: string, b: number): void {}
function takesOne(a: string): void {}

const f: (a: string, b: number) => void = takesOne;   // ✅ — sorprende
```

TS acepta una función con menos params asignada a un tipo con más. Razón: callers pasan ambos args, pero la función simplemente ignora los extras. Es **seguro contravariantemente**.

Pero al revés rompe:

```ts
const f: (a: string) => void = takesTwo;   // ❌ — falta info
```

Otro caso: **uniones de functions requieren la intersección de parámetros**:

```ts
type Handler = ((x: string) => void) | ((x: number) => void);
const h: Handler = ...;
h(/* qué pasar? */);   // tienes que pasar string AND number — i.e. nada
```

TS exige que pases algo asignable a TODAS las firmas. Como `string` ∩ `number` = `never`, no se puede llamar.

## Cómo se compara con nuestro track

Nuestros docs tienen secciones "Trampas" en cada capítulo, pero **dispersas**. Matt las junta en un solo sitio. Si te has tropezado con alguno de estos, este capítulo sistematiza la confusión.

Cross-references:
- "Object.keys" → [doc 25](../effectivetypescript/25-index-signatures-y-record.md), trampa 1.
- "{} es non-nullish" → [doc 25](../effectivetypescript/25-index-signatures-y-record.md), trampa 3.
- "Function assignability contravariante" → [doc 19](../effectivetypescript/19-generics-avanzados.md), sección "Varianza".
- "Type vs Value space" → [doc 23](../effectivetypescript/23-declaration-merging.md), final.

## Ideas que merecen anotarse

### "JavaScript permite esto, TypeScript hereda la rareza"

Casi todas las "weird parts" son consecuencias de **emular JS estructurally**:
- `{}` es JS's "objeto" type, históricamente vacío en JS.
- Excess checks inconsistentes son una concesión a la flexibilidad.
- Function assignability contravariante es porque JS permite ignorar params.

Matt usa estas gotchas para reforzar el mensaje del cap. 1: **TS no quiere ser un lenguaje "más estricto" que JS, quiere ser JS con tipos**.

### `import type` y `verbatimModuleSyntax`

En nuestro tsconfig (`verbatimModuleSyntax: true`):

```ts
import { User } from './user';          // ❌ si User es solo type
import type { User } from './user';     // ✅
import { type User, otherFn } from './user';  // ✅ inline
```

Activo porque facilita el transpile-only (Vite, esbuild, swc) — si saben que un import es solo type, lo borran sin pensar. Sin la directriz, los transpiladores no saben.

### El truco para iterar `Object.keys` con tipo correcto

```ts
const u = { id: '1', email: 'a@b.com' };

// Helper genérico
function typedKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

typedKeys(u).forEach((k) => u[k]);   // k: 'id' | 'email'
```

`type-fest` y otras libs traen versiones más sofisticadas (`StrictObjectKeys`). Para casos puntuales, el cast inline está bien.

## Ejercicio

1. **Excess property check, in y out**: prueba los dos casos del ejemplo. Confirma que el direct-literal falla y el via-variable pasa. ¿Cómo te protege esto? ¿Cómo te jode? Decide qué políticas mantener en tu codebase.

2. **Cast tipado de `Object.keys`**: en `services/node-api/src/lib/`, añade un helper `typedKeys<T>`. Refactoriza algún sitio con `Object.keys` para usarlo.

3. **`{}` vs `Record<string, unknown>`**: declara `function process(input: {})` y luego `function process(input: Record<string, unknown>)`. Pasa un `string` a cada uno. ¿Qué pasa? Es la diferencia core.

4. **`import type` audit**: con `verbatimModuleSyntax: true` activo, busca imports que importan solo tipos sin la marca `type`. ¿Tu lint los detecta? Si no, configura Biome o ESLint para `useImportType`.

5. **`this` typed parameter**: escribe un helper con `this` typed:
   ```ts
   function describe(this: { name: string }): string { ... }
   ```
   Verifica que llamarlo sin `this` falla. Llamarlo con `.call({name: 'Jose'})` pasa.

6. **Reto — function assignability**: declara `type Handler = (e: ClickEvent | KeypressEvent) => void`. Asigna una función que solo maneja `ClickEvent`. ¿Compila? Razón: contravarianza.

## 📖 Otros recursos

- [TypeScript Handbook — Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html) — incluye `import type` y verbatim.
- [Effective TypeScript — Item 10: Avoid Object Wrapper Types](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/object-wrapper.md) — `{}` y wrappers.
- [Anders Hejlsberg — TS Q&A](https://www.youtube.com/results?search_query=anders+hejlsberg+typescript+structural) — por qué TS abrazó la rareza de JS.

---

**Anterior:** [11 — Annotations and Assertions](./11-annotations-and-assertions.md)
**Siguiente:** [13 — Modules, Scripts, and Declaration Files](./13-modules-and-declarations.md)
