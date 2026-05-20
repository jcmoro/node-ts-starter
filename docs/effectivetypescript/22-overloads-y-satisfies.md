# 22 — Overloads y `satisfies`

## El problema

Dos herramientas para diseñar APIs y valores con la **forma exacta** que quieres:

- **Function overloads** — cuando una función tiene varias firmas distintas según los argumentos, y quieres que cada llamada conozca exactamente qué devuelve.
- **`satisfies`** — para decir "este valor cumple con este tipo, pero **mantén** la inferencia específica que TS hace de él".

Ambas resuelven la tensión central en TS: **declarar vs inferir**. Si declaras demasiado, pierdes precisión. Si dejas inferir todo, no validas. `satisfies` y los overloads son las herramientas para conseguir lo mejor de los dos mundos.

## Function overloads — varias firmas, una implementación

JS no tiene overloading por tipo (todo es una sola función). TS te deja **anotar** múltiples firmas y luego implementar **una**:

```ts
function parse(input: string): object;
function parse(input: Buffer): object;
function parse(input: string | Buffer): object {
  const text = typeof input === 'string' ? input : input.toString('utf-8');
  return JSON.parse(text);
}

parse('{"a":1}');                       // ✅
parse(Buffer.from('{"a":1}'));         // ✅
parse(42 as any);                       // ❌ ninguna firma encaja
```

Reglas:

1. Las firmas de overload son **solo tipos** — no tienen cuerpo.
2. La **implementación** debe ser compatible con todas las overloads. Su firma no es visible externamente.
3. Las overloads se resuelven **en orden** — pon las más específicas primero.

> 💡 **Analogía Java**: como overloading de métodos, pero en TS la implementación es una sola, no varias. Más cerca de pattern matching que de dispatch por tipo.

### Caso real — `c.json()` de Hono

Hono tipa `c.json()` con overloads para distinguir status codes:

```ts
// versión simplificada
declare function json<T>(data: T): Response;
declare function json<T, S extends number>(data: T, status: S): Response & { status: S };

const r1 = json({ ok: true });             // Response
const r2 = json({ error: 'x' }, 400);      // Response & { status: 400 }
```

Cada llamada conoce qué status code devuelve a nivel de tipo. Útil para validar handlers contra contratos de API.

### Overloads vs union types — cuándo cada uno

El **conflicto** central: ¿qué prefiero, una función con `(x: A | B): C | D` o dos overloads `(x: A): C; (x: B): D`?

```ts
// Union version
function format(x: string | number): string | number;

// Overload version
function format(x: string): string;
function format(x: number): number;
```

La diferencia se nota en el caller:

```ts
const s = format('hi');  // union: string | number  /  overload: string
const n = format(42);    // union: string | number  /  overload: number
```

Las overloads **preservan la correlación** entre input y output. Las uniones la pierden.

Pero hay un coste: las overloads son más difíciles de mantener y a veces hay alternativas más limpias.

### Overloads vs conditional types

Para muchos casos, un **conditional type** es más limpio que overloads:

```ts
// Con overloads
function getId(input: User): string;
function getId(input: Order): number;
function getId(input: User | Order): string | number { /* ... */ }

// Con conditional type
type IdOf<T> = T extends User ? string : T extends Order ? number : never;
function getId<T extends User | Order>(input: T): IdOf<T> { /* ... */ }
```

La versión con conditional type:
- Es **una sola firma**, más mantenible.
- Funciona para tipos arbitrarios (uniones, genéricos) sin escribir N overloads.
- Tiene mejores mensajes de error en la mayoría de casos.

*Effective TypeScript* item 50 lo dice claro: **prefiere conditional types a overloads** cuando los inputs forman una unión clara. Reserva overloads para casos donde las firmas son **inherentemente distintas** (número de argumentos diferente, callbacks con shapes distintos).

### Cuándo overloads SÍ ganan

```ts
function on(event: 'click', cb: (e: MouseEvent) => void): void;
function on(event: 'keydown', cb: (e: KeyboardEvent) => void): void;
function on(event: string, cb: (e: Event) => void): void { /* ... */ }
```

Aquí, el callback **cambia de tipo** según el primer argumento. Un conditional type lo haría posible pero más oscuro. Con overloads, el caller ve exactamente qué tipo recibe su callback en cada caso.

Otro caso: **arity variable**:

```ts
function combine(a: string): string;
function combine(a: string, b: string): string;
function combine(a: string, b: string, c: string): string;
function combine(...args: string[]): string { return args.join('-'); }
```

Para arity fija, claro. Para variable, mejor `...args`.

### Trampa: orden de overloads

```ts
function foo(x: number | string): boolean;
function foo(x: number): boolean;            // ❌ unreachable
function foo(x: number | string): boolean { /* ... */ }
```

La primera firma engloba a la segunda. La segunda nunca se elige. **Pon la más específica primero.**

## `satisfies` — validar sin perder inferencia

Problema clásico:

```ts
const config: Record<string, string> = {
  api: 'http://localhost:3000',
  db:  'postgres://...',
};

config.api.toUpperCase(); // ✅ pero el tipo es `string`, perdimos el literal
config.foo;               // ✅ TS cree que es string, en runtime es undefined
```

Anotando `Record<string, string>` validas que los valores son strings, pero **pierdes** las claves específicas. TS olvida que `'api'` y `'db'` son las únicas claves.

Alternativa naive — quita la anotación:

```ts
const config = {
  api: 'http://localhost:3000',
  db: 'postgres://...',
};

config.foo; // ❌ correctamente — Property 'foo' does not exist
config.api; // ✅ tipo: string
```

Mejor, pero ahora **no validas** que los valores sean strings. Si alguien escribe `port: 3000`, no protesta.

### La solución: `satisfies`

```ts
const config = {
  api: 'http://localhost:3000',
  db: 'postgres://...',
} satisfies Record<string, string>;

config.api.toUpperCase(); // ✅
config.foo;               // ❌ Property 'foo' does not exist
//        ^^^ claves concretas preservadas
```

`satisfies T` significa: "**verifica** que este valor es asignable a `T`, **pero** infiere el tipo más específico posible".

Cuando hace falta:

- **Configs literales** — quieres que las claves sean conocidas.
- **Tablas de constantes** — `as const` + `satisfies` para máxima precisión.
- **Schemas declarativos** — donde la forma es importante para los consumidores.

### Combinación con `as const`

```ts
const routes = {
  home: '/',
  about: '/about',
  user: '/users/:id',
} as const satisfies Record<string, `/${string}`>;

routes.home; // type: '/' (literal, no string)
routes.user; // type: '/users/:id'
```

- `as const` → todo es `readonly` con literales.
- `satisfies Record<string, /${string}>` → valida que cada valor empieza con `/`.

Si alguien añade `dashboard: 'dashboard'` (sin `/`), TS protesta. Pero los tipos siguen siendo literales: `routes.home` es `'/'`, no `string`.

### `satisfies` vs `as` vs anotación de tipo

```ts
const a: Color = 'red';                 // anotación: valida y reduce a Color
const b = 'red' as Color;                // assertion: fuerza, no valida
const c = 'red' satisfies Color;         // valida pero preserva 'red' literal
```

- **`: T`** (anotación) — declara el tipo. La inferencia se **reduce** a `T`. Útil cuando quieres el tipo amplio.
- **`as T`** (assertion) — fuerza el tipo. **No valida**. Peligroso.
- **`satisfies T`** — valida sin alterar la inferencia. Lo que casi siempre quieres con literales.

Regla mental:

> Si TS sabe deducir un tipo más preciso que el que tú escribirías a mano, usa `satisfies`. Si quieres ocultar detalles tras una abstracción amplia, usa `:`.

### Caso real — routes y handlers tipados

Combinando todo lo del doc 21 + `satisfies`:

```ts
import { Hono } from 'hono';

const routes = {
  health: '/health',
  user: '/users/:id',
  order: '/orders/:orderId',
} as const satisfies Record<string, `/${string}`>;

const app = new Hono();

app.get(routes.user, (c) => {
  const id = c.req.param('id'); // ✅ TS sabe que :id existe
  return c.json({ id });
});

app.get(routes.order, (c) => {
  const orderId = c.req.param('orderId');
  return c.json({ orderId });
});
```

`routes.user` tiene tipo literal `'/users/:id'`. Hono usa ese literal para tipar `c.req.param()`. Si pones `c.req.param('userId')`, no compila.

Sin `satisfies`, `routes.user` sería `string`, Hono no podría inferir nada, y `c.req.param('xxx')` aceptaría cualquier string sin validar.

### Trampa: `satisfies` no es un tipo

```ts
const x = { a: 1, b: 2 } satisfies Record<string, number>;
// typeof x === { a: number; b: number }, no Record<string, number>

function f(r: Record<string, number>) {}
f(x); // ✅ porque el tipo concreto es subtipo del Record
```

`satisfies` solo se aplica a la **expresión**. No puedes usarlo donde se espera un tipo. Para eso usa `:`.

## Combinando todo

```ts
type EventName = 'click' | 'keypress' | 'scroll';

const handlers = {
  click: (x: number, y: number) => `clicked at ${x},${y}`,
  keypress: (key: string) => `pressed ${key}`,
  scroll: (delta: number) => `scrolled ${delta}`,
} satisfies Record<EventName, (...args: any[]) => string>;

function emit<K extends EventName>(
  event: K,
  ...args: Parameters<typeof handlers[K]>
): string {
  return (handlers[event] as any)(...args);
}

emit('click', 10, 20);     // ✅
emit('keypress', 'Enter'); // ✅
emit('scroll', 100);       // ✅
emit('click', 'a');        // ❌ Argument of type 'string' is not assignable to 'number'
```

- `satisfies` valida que cada handler está bien tipado.
- Sin `satisfies`, el genérico `K` y `Parameters<typeof handlers[K]>` no preservarían la firma específica de cada handler.

## Trampas comunes

1. **`satisfies` en exceso**:
   ```ts
   const port = 3000 satisfies number;
   ```
   Aquí no aporta nada — `3000` ya es `number` literal. Reserva `satisfies` para objetos/uniones donde la inferencia precisa importa.

2. **`satisfies` con readonly**: si tu target type pide `readonly`, necesitas `as const`:
   ```ts
   const arr = [1, 2, 3] satisfies readonly number[]; // ⚠️ tipo arr: number[], no readonly
   const arr2 = [1, 2, 3] as const satisfies readonly number[]; // ✅
   ```

3. **Overload + genérico en la implementación**:
   ```ts
   function map<T>(arr: T[], fn: (x: T) => string): string[];
   function map<T>(arr: T[], fn: (x: T) => number): number[];
   function map<T, R>(arr: T[], fn: (x: T) => R): R[] { /* ... */ }
   ```
   Funciona, pero la implementación pierde la correlación de las overloads. Las overloads no se "chequean" contra la implementación, solo se valida compatibilidad. Si te equivocas en una firma, los callers compilan mal.

4. **`satisfies` con tipo demasiado laxo**:
   ```ts
   const c = { a: 1 } satisfies object;
   ```
   `object` acepta casi todo. `satisfies` no aporta validación útil. Usa un tipo que reduzca de verdad.

5. **No mezcles `: T` y `satisfies T`**:
   ```ts
   const x: Foo = {...} satisfies Foo;
   ```
   El `: Foo` ya reduce el tipo. El `satisfies` no aporta nada. Elige uno.

## Ejercicio

1. **Refactoriza un Record con `satisfies`**: en el repo, busca cualquier sitio donde declares `const X: Record<string, Y>`. Cámbialo a `const X = {...} satisfies Record<string, Y>` y comprueba qué tipos se vuelven más precisos.

2. **Tabla de error codes**: crea
   ```ts
   const errorCodes = {
     not_found: { status: 404, message: 'Not found' },
     unauthorized: { status: 401, message: 'Unauthorized' },
   } as const satisfies Record<string, { status: number; message: string }>;
   ```
   Comprueba que `errorCodes.not_found.status` tiene tipo `404` (literal), no `number`.

3. **Overload vs conditional**: implementa `function wrap` con overloads que devuelva `Promise<T>` si el input es `T` (no es Promise), y devuelva `T` si ya es Promise. Luego reescríbelo con conditional types. ¿Cuál prefieres?

4. **Router tipado mínimo**: combina `as const` + `satisfies` + template literal types del doc 21 para hacer una función `route(path)` que extraiga los params de la ruta.

5. **Reto — emitter tipado**: implementa un EventEmitter genérico con `on<K extends EventName>(...)` y `emit<K extends EventName>(...)` que use el patrón de `handlers satisfies Record<...>`. Pista: el truco está en `Parameters<typeof handlers[K]>`.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 21 — *Create Objects All at Once*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/objects-all-at-once.md)** — la razón por la que `satisfies` brilla con literales.
- **[Item 49 — *Use Function Overloading to Model Patterns That Are Easier to Express with Conditional Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/overloads.md)** — cuándo overload, cuándo conditional.
- **[Item 50 — *Prefer Conditional Types to Overloaded Declarations*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/conditional-overload.md)** — la regla por defecto.

---

**Anterior:** [21 — Template literal y mapped types](./21-template-literal-y-mapped-types.md)
**Siguiente:** [23 — Declaration merging y module augmentation](./23-declaration-merging.md)
