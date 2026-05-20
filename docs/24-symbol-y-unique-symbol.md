# 24 — `Symbol` y `unique symbol`

## El problema

El doc 06 introdujo **branded types** para forzar nominalidad en un sistema estructural:

```ts
type Email = string & { readonly __brand: 'Email' };
```

Funciona, pero el "brand" es un **string literal** (`'Email'`). Dos detalles a notar:

1. Si dos librerías distintas hacen `__brand: 'Id'` por separado, **colisionan** — sus tipos brandeados son intercambiables aunque cada lib creía estar protegiendo lo suyo.
2. Cualquiera puede escribir el mismo string literal en su código para forjar un brand "ajeno".

JavaScript tiene **`symbol`** desde ES2015: un primitivo cuyo principal valor es **garantizar identidad única**. Dos `Symbol("foo")` distintos son **diferentes**, aunque tengan la misma descripción. Y TypeScript añade **`unique symbol`** — un subtipo a nivel de tipos que vincula una variable `const` a **su propia identidad de símbolo**, imposible de duplicar.

Este doc cubre:
- `symbol` como primitivo runtime.
- `unique symbol` como herramienta type-level.
- Branded types más estrictos con `unique symbol` (lo que hace Zod internamente).
- Well-known symbols (`Symbol.iterator`, `Symbol.toPrimitive`, etc.) para implementar protocolos.
- El patrón "extensión sin colisión" para librerías.

## `symbol` (runtime) vs `unique symbol` (type-level)

### `symbol` — el primitivo

```ts
const a = Symbol('foo');
const b = Symbol('foo');

console.log(a === b);          // false — descripciones iguales, identidades distintas
console.log(typeof a);          // 'symbol'

const x: symbol = a;            // x es del tipo amplio `symbol`
const y: symbol = b;
```

`Symbol("descripcion")` crea un valor único. La descripción es **solo para debug** (aparece en `.toString()`), no afecta la identidad. Dos `Symbol("foo")` son **no-iguales**.

### `Symbol.for(key)` — registry global

Si necesitas el mismo símbolo en lugares desconectados:

```ts
const a = Symbol.for('app.user.role');
const b = Symbol.for('app.user.role');

console.log(a === b);          // true — registry global lo deduplica
```

Útil para **protocolos cross-realm** (módulos, workers, iframes). Para casi todo lo demás, **prefiere `Symbol(...)`** — el registry es un namespace global compartido y se llena rápido.

### `unique symbol` — la identidad a nivel de tipo

```ts
const TAG: unique symbol = Symbol('tag');
//    ^? typeof TAG (un tipo único — solo TAG es asignable)

type T = typeof TAG;            // tipo opaco, único a esta declaración

const other: typeof TAG = Symbol('tag');  // ❌ no es exactamente TAG
const same: typeof TAG = TAG;            // ✅
```

**`unique symbol` solo se aplica a `const` declarations** y a `readonly static` properties. La razón: el tipo se vincula a **una identidad concreta** que no puede cambiar.

```ts
let TAG: unique symbol = Symbol();  // ❌ Type 'unique symbol' is not assignable to mutable variable
```

> 💡 **Mental model**: `symbol` es el tipo amplio ("cualquier símbolo"). `unique symbol` es como un **literal type** para símbolos: representa **exactamente este símbolo concreto**, declarado en este `const`.

## Brand con `unique symbol` — la versión robusta

El branded type del doc 06 con string literal:

```ts
type Email = string & { readonly __brand: 'Email' };
```

La versión con `unique symbol`:

```ts
declare const EmailBrand: unique symbol;
type Email = string & { readonly [EmailBrand]: 'Email' };
```

Tres diferencias importantes:

1. **El `Brand` ya no es un string literal** — es la identidad del símbolo `EmailBrand`. Otra lib no puede crear el mismo `unique symbol` por accidente.
2. **El campo es computed property** `[EmailBrand]` — usa el símbolo como key. En runtime no existe (es declaración fantasma), pero a nivel de tipo es único.
3. **`declare const`** — anuncia el símbolo sin crear el valor. Útil cuando no quieres exportar el símbolo runtime, solo usarlo como token de tipos.

### Patrón Zod (referencia del repo)

Mira `services/node-api/node_modules/zod/lib/types.d.ts` (o el del package en npm). Internamente Zod hace algo así:

```ts
export declare const BRAND: unique symbol;
export type BRAND<T extends string | number | symbol> = {
    [BRAND]: { [k in T]: true };
};
```

Y cuando haces `z.string().brand<'Email'>()`, el tipo resultante es `string & BRAND<'Email'>` — combina el `unique symbol` (Zod controla) con el discriminator literal (el usuario controla). Por eso `Email` brandeado en tu repo es **inforjable** desde código fuera de Zod.

> 💡 **Cuándo el brand con `unique symbol` importa**: en código de aplicación, el brand con string literal del doc 06 es suficiente (controlas todo el código). En **librerías publicadas** donde los consumers podrían colisionar con tu brand, `unique symbol` es la única opción robusta.

## Well-known symbols — protocolos del lenguaje

JS define varios símbolos pre-construidos en el objeto global `Symbol`. Implementarlos en tus objetos los enchufa a sintaxis del lenguaje. Los más relevantes:

### `Symbol.iterator` — protocolo iterable

```ts
class Range {
    constructor(private start: number, private end: number) {}

    [Symbol.iterator](): Iterator<number> {
        let i = this.start;
        return {
            next: () => i < this.end
                ? { value: i++, done: false }
                : { value: undefined, done: true },
        };
    }
}

for (const n of new Range(0, 5)) {
    console.log(n);              // 0 1 2 3 4
}

console.log([...new Range(0, 3)]);  // [0, 1, 2]
```

Implementar `[Symbol.iterator]` hace que tu objeto sea utilizable con `for...of`, spread, `Array.from()`, destructuring. **No** necesitas heredar de nada — el protocolo se basa puramente en la presencia del método con esa key.

### `Symbol.asyncIterator` — para streams

Similar pero para async/await:

```ts
class TickStream {
    async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 3; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            yield i;
        }
    }
}

for await (const n of new TickStream()) {
    console.log(n);              // 0, 1, 2 (con 1s entre cada uno)
}
```

`async function*` es la sintaxis idiomática (devuelve un async iterable + iterator a la vez). Lo usarás en cap. 26 cuando entremos en `Promise<T>` y async.

### `Symbol.toPrimitive` — controlar conversiones

```ts
class Temperature {
    constructor(public celsius: number) {}

    [Symbol.toPrimitive](hint: 'number' | 'string' | 'default'): string | number {
        if (hint === 'number') return this.celsius;
        if (hint === 'string') return `${this.celsius}°C`;
        return this.celsius;
    }
}

const t = new Temperature(25);
console.log(+t);                 // 25 (hint: 'number')
console.log(`${t}`);             // '25°C' (hint: 'string')
console.log(t + '');             // '25' (hint: 'default')
```

Útil cuando tu objeto representa una cantidad y quieres que `t + 5` u operaciones similares funcionen sin fricción.

### `Symbol.hasInstance` — `instanceof` custom

```ts
class Even {
    static [Symbol.hasInstance](value: unknown): boolean {
        return typeof value === 'number' && value % 2 === 0;
    }
}

console.log(2 instanceof Even);  // true
console.log(3 instanceof Even);  // false
```

Sobrescribe `instanceof` con tu propia lógica. Útil para "tipos virtuales" que no son clases reales.

## Symbol-keyed properties — el patrón "metadata sin colisión"

Las properties con symbol-keys **no aparecen** en:

- `for...in` loops.
- `Object.keys(obj)`.
- `JSON.stringify(obj)` (no se serializan).

Sí aparecen en:

- `Object.getOwnPropertySymbols(obj)`.
- `Reflect.ownKeys(obj)`.
- Acceso directo `obj[someSymbol]`.

Esto es **deliberado** — symbols son el espacio canónico para metadata "no observable por defecto".

### Patrón de extensión sin colisión

```ts
// Lib X exporta su propio symbol:
export const xMetadata: unique symbol = Symbol('lib-x.metadata');

// Consumer adjunta datos a sus objetos sin riesgo de colisionar con otras libs:
const user = { name: 'Jose', email: 'jose@example.com' };
(user as any)[xMetadata] = { createdAt: Date.now() };

// La lib X lee su metadata sin pisar las keys del consumer:
function getMetadata(obj: object) {
    return (obj as any)[xMetadata];
}
```

Resultado: Lib X puede inyectar y leer su info en cualquier objeto del consumer sin contaminar el namespace de keys de string. Útil para:

- ORMs que adjuntan metadata de tracking.
- Decorators / reflection.
- Caches keyed por instancia.

## `WeakMap` como alternativa (con menos boilerplate de tipos)

Para casos donde no necesitas el `unique symbol` específicamente, **`WeakMap` es a menudo más limpio**:

```ts
const metadata = new WeakMap<object, { createdAt: number }>();

const user = { name: 'Jose' };
metadata.set(user, { createdAt: Date.now() });

console.log(metadata.get(user)?.createdAt);
```

Ventajas de `WeakMap`:
- **No contamina** el objeto.
- **GC-friendly**: cuando `user` es coleccionable, su entry en el `WeakMap` también lo es.
- Tipo natural sin truco de symbols.

Desventajas:
- Solo objects/symbols como keys (no primitivos).
- No iterable (por diseño: si pudieras enumerar las keys, no serían "weak").

**Cuándo cada uno**:
- Necesitas que la metadata viaje con el objeto (serialización custom, propagación entre módulos sin shared state): symbol-keyed property.
- Necesitas asociar info externamente sin tocar el objeto: `WeakMap`.

## Trampas comunes

1. **`Symbol("foo") === Symbol("foo")` es `false`**: el primer error de quien empieza con symbols. La descripción es solo para debug.

2. **`unique symbol` solo en `const`**:
   ```ts
   let TAG: unique symbol = Symbol();   // ❌
   const TAG: unique symbol = Symbol(); // ✅
   ```
   Tampoco vale en `class` fields que no sean `readonly static`.

3. **Symbol no es JSON-serializable**:
   ```ts
   const obj = { name: 'foo', [Symbol('x')]: 'metadata' };
   console.log(JSON.stringify(obj));   // {"name":"foo"}  ← el symbol desapareció
   ```
   Bien para metadata privada que no quieres exportar. **Mal** si esperabas que viajara con el JSON.

4. **`Symbol.for("foo")` es global**:
   ```ts
   // moduleA.ts
   const tag = Symbol.for('app.tag');

   // moduleB.ts
   const tag = Symbol.for('app.tag');  // mismo símbolo
   ```
   El registry compartido es un namespace que puede colisionar con otras libs (especialmente con strings genéricos como `'tag'`, `'id'`). Usa `Symbol(...)` privado por defecto; reserva `Symbol.for()` para protocolos donde necesitas cross-module identity.

5. **`Object.keys` no ve symbol keys** — y a veces lo descubres a las malas:
   ```ts
   const obj = { regular: 1, [Symbol('hidden')]: 2 };
   Object.keys(obj);                       // ['regular']
   Object.getOwnPropertySymbols(obj);      // [Symbol(hidden)]
   Reflect.ownKeys(obj);                   // ['regular', Symbol(hidden)]
   ```

6. **`hasOwnProperty` falla con symbol keys directos**:
   ```ts
   const TAG = Symbol();
   const obj = { [TAG]: 1 };
   obj.hasOwnProperty(TAG);                 // ✅ true, pero
   Object.prototype.hasOwnProperty.call(obj, TAG);  // más seguro
   ```
   Si la clase de `obj` no hereda de `Object.prototype` (objeto creado con `Object.create(null)`), `.hasOwnProperty` no existe.

7. **`typeof obj[Symbol.iterator]` cuando obj no lo tiene**:
   ```ts
   const obj: object = {};
   for (const _ of obj as any) { }      // TypeError en runtime
   ```
   Verifica antes con `Symbol.iterator in obj`.

8. **Confusión `typeof X` cuando X tiene `unique symbol`**: el tipo `typeof X` es **la identidad del símbolo**, no el `symbol` amplio. Asignar el `symbol` amplio al `unique` falla.

## Ejercicio

1. **Refactor branded `Email` con `unique symbol`**: en `services/node-api/src/domain/user.ts`, define `declare const EmailBrand: unique symbol` y un tipo `BrandedEmail = string & { readonly [EmailBrand]: 'Email' }`. Compáralo con el actual brand-via-Zod. ¿En qué se diferencian al ojo? ¿Qué garantía gana el `unique symbol`?

2. **Implementa `[Symbol.iterator]` sobre `Range`**: clase simple que itere de `start` a `end` exclusive. Confirma que `for...of`, spread, y `Array.from(...)` funcionan.

3. **Async iterator real**: implementa una clase `PolledStream<T>` que cada N segundos llame a una función async y yield el resultado, vía `[Symbol.asyncIterator]`. Pruébalo con `setInterval` simulado.

4. **`Symbol.toPrimitive` para una clase `Money`**: representa una cantidad en céntimos. Implementa `toPrimitive` para que `+money` devuelva los céntimos como number y `\`${money}\`` devuelva una cadena tipo `"€12.34"`.

5. **WeakMap vs symbol-keyed**: implementa el mismo "metadata store" (timestamp por user) de dos formas — WeakMap externo y symbol-keyed property en el objeto. Compara: ¿cuál te resulta más natural? ¿Cuál te molesta menos cuando inspeccionas el objeto con `console.log`?

6. **Reto**: implementa una mini-versión del `BRAND` de Zod. Define `BRAND: unique symbol` y un tipo `Brand<T, B extends string>` que combine `T` con `{ [BRAND]: { [k in B]: true } }`. Crea un helper `brand<B>(value)` que casteo. Verifica con type-level testing (doc 14) que `Brand<string, 'Email'>` no es asignable a `Brand<string, 'UserId'>`.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 64 — *Consider Brands for Nominal Typing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/brands.md)** — ya cubierto en doc 06; relee con la sección de symbol-based brands.
- **[Item 53 — *Use Template Literal Types to Model DSLs and Relationships Between Strings*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/template-literals.md)** — relacionado: cuándo prefieres template literals vs unique symbols como token de identidad.

### Documentación y referencias

- [TypeScript Handbook — Symbols](https://www.typescriptlang.org/docs/handbook/symbols.html) — referencia oficial.
- [MDN — Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) — el primitivo runtime con todos los well-known symbols listados.
- [MDN — Well-known symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol#well-known_symbols) — `Symbol.iterator`, `Symbol.asyncIterator`, `Symbol.toPrimitive`, etc.
- [Colin Hacks (Zod author) — Brand types](https://github.com/colinhacks/zod/blob/main/src/types.ts) — busca `BRAND` y observa el patrón con `unique symbol` real.

### Conceptual

- [JEP / TC39 — Symbol primitive (ES2015)](https://tc39.es/ecma262/#sec-ecmascript-language-types-symbol-type) — el spec original.
- [TypeScript 2.7 release notes — `unique symbol`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-7.html#unique-symbol) — la introducción del tipo.

---

**Anterior:** [23 — Declaration merging y module augmentation](./23-declaration-merging.md)
**Siguiente:** [25 — Index signatures, `Record` y mapped types dinámicos](./25-index-signatures-y-record.md)
