# 25 — Index signatures, `Record` y mapped types dinámicos

## El problema

A veces tienes un objeto del que **conoces el tipo de los valores** pero **no las keys** (o sabes solo un set parcial). Tres ejemplos del día a día:

- Una caché simple: `{ [email: string]: User }`.
- Un mapa de configuración por entorno: `{ dev: Config; staging: Config; prod: Config }`.
- Un diccionario `i18n`: `{ "user.title": "Usuario"; "user.email": "Email"; ... }`.

TS tiene **tres herramientas** que se solapan parcialmente: **index signatures**, **`Record<K, V>`**, y **mapped types**. Elegir mal es la fuente del 80% de los `Object is possibly 'undefined'` que vas a pelear en código estricto.

Este doc cubre cuándo cada una, las trampas con los dos flags estrictos relevantes (`noUncheckedIndexedAccess` y `noPropertyAccessFromIndexSignature`, ambos activos en este repo), y la alternativa runtime con `Map<K, V>`.

## Index signatures

La sintaxis clásica:

```ts
type StringMap = {
  [key: string]: number;
};

const m: StringMap = { a: 1, b: 2 };
m.c = 3;                              // ✅ cualquier key vale
const v: number = m.unknown;          // ⚠️ ver noUncheckedIndexedAccess
```

Lectura: "este objeto tiene cero o más propiedades, las keys son strings, y los valores son `number`".

### Mezclando index signature con propiedades concretas

```ts
type Config = {
  name: string;
  [key: string]: string;
};

const c: Config = { name: 'foo', host: 'localhost', port: '3000' };
```

Aquí `name` es explícito (siempre presente) y el resto sigue el index signature. **Constraint importante**: las propiedades concretas tienen que ser **asignables al tipo del index**.

```ts
type Bad = {
  name: string;
  [key: string]: number;      // ❌ Property 'name' of type 'string' is not
  //                              assignable to 'string' index type 'number'.
};
```

Es lógico: si alguien hace `obj['name']`, TS le promete `number` por el index signature; pero `name` es `string`. Conflicto.

### `noUncheckedIndexedAccess` — el flag que pone `| undefined`

En `services/node-api/tsconfig.json` tenemos este flag activo. Cambia el tipo de acceso por index:

```ts
const m: { [k: string]: number } = { a: 1 };

// Sin noUncheckedIndexedAccess:
const v = m.b;                        // type: number — pero en runtime es undefined
v.toFixed(2);                          // TypeError en runtime

// Con noUncheckedIndexedAccess:
const v = m.b;                        // type: number | undefined ✅
v.toFixed(2);                          // ❌ Object is possibly 'undefined'
v?.toFixed(2);                         // ✅ con optional chaining
```

**Esto es lo correcto**. Sin el flag, TS te miente — promete que la propiedad existe cuando puede no existir. **Manténlo activo siempre**.

### `noPropertyAccessFromIndexSignature` — separar concreto de dinámico

También activo en el repo. Obliga a distinguir sintácticamente entre acceso a propiedades **declaradas** y acceso por index:

```ts
type Config = {
  host: string;
  [k: string]: string;
};

const c: Config = { host: 'localhost' };

c.host;                                // ✅ propiedad declarada → notación punto
c['anything'];                         // ✅ propiedad por index → bracket notation
c.anything;                            // ❌ Property 'anything' comes from an
                                       //    index signature, use ['anything'] instead.
```

El beneficio: leer `c.host` indica visualmente "esta es una propiedad de schema conocida"; `c['anything']` indica "esto viene del lado abierto". Cuesta una pequeña fricción al teclear, paga en legibilidad al leer.

### Keys numéricas

```ts
type Arr = {
  [index: number]: string;
};
```

Esto **modela arrays**. En runtime JS convierte keys numéricas a strings (`obj[1]` = `obj["1"]`), pero TS las distingue a nivel de tipo. Una `number` index signature **es más estricta** que `string` (toda key numérica es string-convertible pero no al revés).

```ts
type Both = {
  [index: number]: string;      // valores en posición numérica → string
  [key: string]: string;        // todo lo demás → string
};
```

Si declaras ambas, la `number` debe ser **subtipo** de la `string`. Útil cuando quieres "string keys con un comportamiento especial para integers" (raro fuera de modelar Array-like).

### Keys de símbolo

Desde TS 4.4, las index signatures aceptan `symbol`:

```ts
type WithSymbols = {
  [key: symbol]: string;
};
```

Útil para los protocolos del doc 24 — colecciones que aceptan symbol keys como metadata.

## `Record<K, V>`

Es un **mapped type** built-in:

```ts
type Record<K extends string | number | symbol, V> = {
  [P in K]: V;
};
```

La diferencia con index signature: `K` puede ser **finito** (literal union) o **infinito** (`string`/`number`/`symbol`).

```ts
type R1 = Record<string, number>;
// ≈ { [key: string]: number }    (infinito, comportamiento idéntico)

type R2 = Record<'dev' | 'staging' | 'prod', Config>;
// = { dev: Config; staging: Config; prod: Config }   (finito, propiedades obligatorias)
```

**Casos prácticos**:

### Lookup table exhaustivo

```ts
type Status = 'pending' | 'approved' | 'rejected';

const labels: Record<Status, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
};
```

Si añades `'expired'` al union `Status` y no actualizas `labels`, **TS rompe la compilación** — "Property 'expired' is missing in type ...". Garantía de exhaustividad **gratis**.

### Mapa de handlers por type

```ts
type EventName = 'click' | 'scroll' | 'keypress';

const handlers: Record<EventName, (e: Event) => void> = {
  click: (e) => console.log('click', e),
  scroll: (e) => console.log('scroll', e),
  keypress: (e) => console.log('keypress', e),
};

function dispatch(name: EventName, e: Event) {
  handlers[name](e);   // tipo: (e: Event) => void — sin undefined si Status es finito
}
```

Nota: con `Record<Status, ...>` donde `Status` es **finito** y todas las claves están presentes, **el acceso `handlers[name]` no devuelve `| undefined`** incluso con `noUncheckedIndexedAccess`. La razón: `name: Status` solo puede ser una de las claves conocidas; no es un string arbitrario.

### Optional record con `Partial<Record<K, V>>`

```ts
type Translations = Partial<Record<Locale, string>>;

const titles: Translations = {
  en: 'User',
  es: 'Usuario',
  // 'fr' no está — y TS lo permite porque es Partial
};

const title = titles.en;              // type: string | undefined
```

Esto modela "puede que tenga unas keys de la unión, puede que no". Mucho más expresivo que `{ [key: string]: string }` porque al menos sabes **qué keys son posibles**.

## Cuándo cada uno — tabla de decisión

| Caso                                              | Mejor                                  |
|---------------------------------------------------|----------------------------------------|
| Cache con keys arbitrarios (`userId → User`)      | `Record<string, User>` o index sig     |
| Lookup exhaustivo (`Status → string`)             | `Record<Status, string>`               |
| Lookup parcial (`Locale → string` opcional)       | `Partial<Record<Locale, string>>`     |
| Config con campos fijos + extras                  | Tipo mixto: campos + index signature  |
| Necesitas iterar mucho y orden garantizado        | `Map<K, V>` (runtime)                  |
| Necesitas keys que no son strings (objects, etc.) | `Map<K, V>` (runtime)                  |
| Va a JSON                                          | `Record` u object (Map no serializa)  |

> 💡 **Regla mental**: `Record<UnionLiteral, V>` cuando las keys son **finitas y conocidas**. Index signature (o `Record<string, V>`) cuando son **abiertas**. Si dudas, empieza con el finito; si no escala, abre.

## Mapped types dinámicos — más allá de `Record`

`Record` es el caso más simple de mapped type. Patterns más expresivos (cubiertos a fondo en doc 21):

### Mapeo con renombrado (`as`)

```ts
type Getters<T> = {
  [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K];
};

type User = { name: string; age: number };
type UserGetters = Getters<User>;
// {
//   getName: () => string;
//   getAge: () => number;
// }
```

### Filtrar claves con `as never`

```ts
type RemovePrivate<T> = {
  [K in keyof T as K extends `_${string}` ? never : K]: T[K];
};

type Foo = { name: string; _internal: number; age: number };
type Public = RemovePrivate<Foo>;
// { name: string; age: number }
```

### Derivar de uniones de literales

```ts
type Roles = 'admin' | 'user' | 'guest';
type Permissions = { [R in Roles]: string[] };
// = { admin: string[]; user: string[]; guest: string[] }
```

Eso es exactamente lo que hace `Record<Roles, string[]>`. **`Record<K, V>` no es más que azúcar para `{ [K in Keys]: V }`**.

## `Map<K, V>` — la alternativa runtime

Cuando el objeto literal no encaja por características de runtime (orden, performance, keys no-string), usa `Map`:

```ts
const cache = new Map<string, User>();
cache.set('jose@example.com', { id: '1', name: 'Jose' });
cache.get('jose@example.com');         // type: User | undefined

cache.set(someUser, 'value');           // ❌ key debe ser string
const m2 = new Map<User, string>();
m2.set(someUser, 'value');              // ✅ keys arbitrarios
```

Ventajas de `Map`:

- **Cualquier key**: objects, primitives, symbols. (`Record` solo string/number/symbol).
- **Orden de inserción garantizado** en iteración.
- **Performance**: O(1) garantizado para muchas keys; objects degradan con prototype lookups.
- **Tamaño accesible**: `map.size` directo.
- **Iteración con tipo correcto**: `for (const [k, v] of map)` tiene el `[K, V]` tipado.

Desventajas:

- **No es JSON-serializable**: `JSON.stringify(map)` → `"{}"`.
- **Sintaxis más verbosa** que object literal.
- **Spread/destructuring** no funcionan.

**Cuándo usar `Map`**:
- Caché grande con turnover (mucho `set`/`delete`).
- Keys que no son strings (DOM nodes, instances).
- Iteración por orden de inserción.
- Casos donde el GC podría liberar el contenedor (`WeakMap` específicamente).

**Cuándo usar object literal + `Record`**:
- Datos JSON-like.
- Estructura conocida y estable.
- Frontend state que pasa por reducers/diffing (más fácil con objetos).
- DTOs hacia el cliente.

## Trampas comunes

1. **`Object.keys(obj)` devuelve `string[]`, no `keyof typeof obj`**:
   ```ts
   const config: Record<'a' | 'b', number> = { a: 1, b: 2 };
   for (const k of Object.keys(config)) {
     config[k];                          // ❌ Type 'string' can't index 'Record<'a'|'b', number>'
   }
   ```
   Razones: a tiempo de runtime, `obj` puede tener más keys (heredadas, inyectadas) de las que el tipo declara. TS es estructural: cualquier objeto con `{ a, b }` es asignable a `Record<'a'|'b', number>`, así que `Object.keys` puede devolver cualquier cosa. Fix: cast explícito si estás seguro, o usar:
   ```ts
   (Object.keys(config) as (keyof typeof config)[]).forEach(...);
   ```
   o pares con `Object.entries(config)`.

2. **`for...in` recorre el prototype chain**:
   ```ts
   for (const k in obj) {
     // recorre Object.prototype también
   }
   ```
   Usa `Object.keys(obj)` (own properties), `Object.entries(obj)`, o `Reflect.ownKeys(obj)` (incluye symbols).

3. **`Record<string, T>` acepta `{}`**:
   ```ts
   const r: Record<string, number> = {};   // ✅
   ```
   `Record<string, T>` significa "cero o más props string → T". El conjunto vacío vale. Si quieres "al menos una", no hay forma directa en TS — modela explícitamente.

4. **Mezclando index signature con `?` (optional)**:
   ```ts
   type Config = {
     [key: string]: string | undefined;   // ✅ explícito
     name?: string;                         // ✅ name puede faltar
   };
   ```
   Si el index value es `string`, una `name?` que es `string | undefined` viola el contrato (`undefined` no es `string`). Hazlo explícito: `[key: string]: string | undefined`.

5. **`Record<K, V>` no es exhaustivo si `K = string`**:
   ```ts
   const r: Record<string, number> = { a: 1 };
   r.b = 2;                              // ✅ — cualquier string vale
   ```
   No hay "missing keys" check. Solo `Record<UnionLiteral, V>` es exhaustivo.

6. **`Map.get(k)` siempre devuelve `T | undefined`** — incluso si "sabes" que existe:
   ```ts
   const m = new Map([['a', 1]]);
   m.get('a').toFixed(2);                // ❌
   m.get('a')!.toFixed(2);                // ⚠️ assertion peligrosa
   const v = m.get('a');                 // mejor:
   if (v !== undefined) v.toFixed(2);
   ```

7. **Sobrecargar `Record<symbol, V>` perdiendo introspección**: las symbol keys no aparecen en `Object.keys`. Si necesitas iterar, usa `Object.getOwnPropertySymbols` o `Reflect.ownKeys`.

8. **`Record<number, V>` no es lo que esperas**:
   ```ts
   const r: Record<number, string> = {};
   r[1] = 'one';                         // OK
   r['1'] = 'also one';                  // ❌ con noUncheckedIndexedAccess raro
   ```
   En runtime `r[1]` y `r["1"]` son lo mismo. TS los distingue. Para "diccionario por entero", probablemente quieres `Map<number, V>`.

9. **`for...of Object.entries(record)` pierde tipo en value**:
   ```ts
   const r: Record<'a' | 'b', number> = { a: 1, b: 2 };
   for (const [k, v] of Object.entries(r)) {
     v;                                   // type: number ✅
     k;                                   // type: string ❌ (no 'a'|'b')
   }
   ```
   Mismo problema que `Object.keys`. Cast a `[keyof typeof r, number][]` si lo necesitas tipado.

## Ejercicio

1. **Refactor cache con `Record` exhaustivo**: define un `type Region = 'eu' | 'us' | 'ap'` y un `Record<Region, string>` para URLs por región. Confirma que omitir una región rompe la compilación. Compara con el equivalente `{ [k in Region]?: string }` (partial) y mira cuándo elegirías uno u otro.

2. **`Partial<Record<K, V>>` para handlers opcionales**: implementa `type EventHandlers = Partial<Record<EventName, (e: Event) => void>>`. Demuestra que algunas keys pueden faltar y el acceso devuelve `| undefined`.

3. **`noUncheckedIndexedAccess` en práctica**: con el flag activo (ya lo está en `services/node-api/tsconfig.json`), accede a un `Record<string, User>` con una key que no sabes si existe. Observa el error. Arréglalo con `?.` o `if (v !== undefined)`.

4. **`Object.keys` y el cast forzoso**:
   ```ts
   type Cfg = Record<'a' | 'b', number>;
   const c: Cfg = { a: 1, b: 2 };
   const ks = Object.keys(c);             // string[]
   const tks = Object.keys(c) as (keyof Cfg)[];  // 'a'|'b'[]
   ```
   ¿Cuándo es seguro castear? ¿Cuándo no? Pista: solo si controlas el origen del objeto (literal en tu código) y no proviene de JSON / red.

5. **Mapped type que cambia los valores a Promises**:
   ```ts
   type Async<T> = { [K in keyof T]: Promise<T[K]> };
   type X = Async<{ name: string; age: number }>;
   // { name: Promise<string>; age: Promise<number> }
   ```
   Implementa y úsalo. Comparar con `Record` — Record cambia *los valores* a un tipo fijo; mapped type general puede *transformar* los valores.

6. **Reto — `Map` vs `Record` benchmark teórico**: piensa en un sistema con 100k entries que se acceden por key random. ¿Cuál esperarías que sea más rápido? ¿Y para 10 entries? ¿Por qué? (Pista: V8 internamente, los objects "se especializan" para pocas keys con shapes/hidden classes.)

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 17 — *Avoid Number Index Signatures*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/no-num-index.md)** — por qué `Array<T>` o `ReadonlyArray<T>` casi siempre superan a `{ [n: number]: T }`.
- **[Item 33 — *Prefer Arrays, Tuples, and ArrayLike to Number Index Signatures*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/array-not-num-index.md)** — el caso a favor de tuples y arrays.
- **[Item 60 — *Know How to Iterate Over Objects*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/iterate-objects.md)** — la trampa del `for...in` y el cast de `Object.keys`.

### Documentación oficial

- [TypeScript Handbook — Index Signatures](https://www.typescriptlang.org/docs/handbook/2/objects.html#index-signatures) — referencia oficial concisa.
- [TypeScript Handbook — Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html) — el modelo general detrás de `Record`.
- [TypeScript Reference — `noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess) — qué hace, ejemplos.
- [TypeScript Reference — `noPropertyAccessFromIndexSignature`](https://www.typescriptlang.org/tsconfig#noPropertyAccessFromIndexSignature) — el otro flag estricto del repo.

### Conceptual

- [MDN — Map vs Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map#objects_vs._maps) — tabla canónica de diferencias.
- [V8 — Object shapes / hidden classes](https://v8.dev/blog/fast-properties) — por qué objects con pocas keys son rápidos.

---

**Anterior:** [24 — `Symbol` y `unique symbol`](./24-symbol-y-unique-symbol.md)
**Siguiente:** [26 — Async, `Promise<T>` y `Awaited<T>`](./26-async-promise-awaited.md)
