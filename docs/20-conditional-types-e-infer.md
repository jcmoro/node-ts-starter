# 20 — Conditional types e `infer`

## El problema

A veces el tipo que quieres devolver **depende** del tipo que entra. Ejemplos del día a día:

- "Si me das un `Promise<X>`, dame `X`. Si no, dame lo que sea que me diste."
- "Si me das un array, dame su elemento. Si no, error."
- "Si la función tiene parámetros, deja que los componga; si no, llámala directamente."

Con generics simples no llegas: `<T>(x: T) => T` solo devuelve lo mismo que entra. Necesitas que el tipo **inspeccione** la forma de `T` y decida.

Eso son los **conditional types**.

## La sintaxis

```ts
type If<C extends boolean, T, F> = C extends true ? T : F;

type A = If<true, 'yes', 'no'>;  // 'yes'
type B = If<false, 'yes', 'no'>; // 'no'
```

La forma es **idéntica a un ternario de JS**, pero a nivel de tipos:

```
T extends U ? X : Y
```

"Si `T` es subtipo (o asignable) a `U`, el tipo es `X`; si no, `Y`."

> 💡 **Analogía Java/Go**: no hay equivalente. Java no tiene cómputo sobre tipos. Lo más cercano es la metaprogramación de C++ con templates, pero TS lo hace con sintaxis legible.

## Caso de uso 1 — filtrar uniones

```ts
type ExtractStrings<T> = T extends string ? T : never;

type T1 = ExtractStrings<'a' | 'b' | number | boolean>;
//   ^? 'a' | 'b'
```

¿Por qué funciona? Por la **propiedad distributiva** de los conditional types: cuando `T` es una unión, TS **mapea** el conditional sobre cada miembro:

```
ExtractStrings<'a' | 'b' | number | boolean>
= ExtractStrings<'a'> | ExtractStrings<'b'> | ExtractStrings<number> | ExtractStrings<boolean>
= 'a' | 'b' | never | never
= 'a' | 'b'
```

`never` actúa como "nada" en una unión (es el cero del operador `|`), así que desaparece. Por eso `never` en la rama "false" de un conditional **filtra** miembros.

Esto es exactamente lo que hacen `Extract` y `Exclude` (built-in):

```ts
type Extract<T, U> = T extends U ? T : never;
type Exclude<T, U> = T extends U ? never : T;

type Status = 'pending' | 'success' | 'error';
type Failure = Exclude<Status, 'success'>; // 'pending' | 'error'
```

## Distribución: dónde te puede joder

La distribución solo ocurre cuando el `T` del conditional es **un type parameter "naked"** (sin envolver). Si lo envuelves, no distribuye.

```ts
type ToArray<T> = T extends any ? T[] : never;
type A = ToArray<string | number>; // string[] | number[]   ← distribuyó

type ToArray2<T> = [T] extends [any] ? T[] : never;
type B = ToArray2<string | number>; // (string | number)[]  ← NO distribuyó
```

El truco `[T] extends [U]` es la forma de **forzar no-distribución**. Lo usas cuando quieres tratar la unión como una unidad.

Cuándo cada uno:
- **Distribuye** cuando quieres aplicar la condición a cada miembro (filtrar, mapear).
- **No distribuye** cuando quieres tratar la unión completa (comparaciones, "está vacía la unión").

```ts
type IsNever<T> = [T] extends [never] ? true : false;
//                ^^^ obligatorio: si fuera 'T extends never', distribuiría
//                    y siempre daría never (porque la unión vacía es never)
```

## `infer` — el truco que cambia todo

Dentro del lado izquierdo del `extends`, puedes declarar una variable de tipo con `infer X`. TS la **deduce** del patrón. Es la herramienta más potente del sistema de tipos.

```ts
type ElementOf<T> = T extends (infer U)[] ? U : never;

type A = ElementOf<string[]>;        // string
type B = ElementOf<Array<{ id: 1 }>>; // { id: 1 }
type C = ElementOf<number>;          // never (no es array)
```

Léelo así: "si `T` tiene la forma `(algo)[]`, capturo ese algo en `U` y lo devuelvo".

Más ejemplos:

```ts
type Awaited<T> = T extends Promise<infer U> ? U : T;
//                                ^^^^^^^^
// si T es Promise<X>, da X; si no, deja T como está

type A = Awaited<Promise<User>>;  // User
type B = Awaited<number>;         // number
```

Esta es la versión naive de `Awaited<T>` que ya viene en la librería estándar (la real recursivamente desempaqueta promesas anidadas).

### Inferir el retorno de una función

```ts
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;

function makeUser() { return { id: '1', name: 'Jose' }; }
type U = ReturnOf<typeof makeUser>;
//   ^? { id: string; name: string }
```

`ReturnOf` ya existe nativo como `ReturnType<T>`. Lo escribo para que veas la mecánica.

### Inferir parámetros

```ts
type Params<T> = T extends (...args: infer P) => any ? P : never;

function greet(name: string, age: number) { /* ... */ }
type P = Params<typeof greet>; // [name: string, age: number]
```

Existe nativo como `Parameters<T>`. Útil cuando quieres componer funciones — "aplica la misma lista de argumentos a otra cosa":

```ts
function withLogging<F extends (...args: any[]) => any>(fn: F): F {
  return ((...args: Parameters<F>) => {
    console.log('calling', fn.name, args);
    return fn(...args);
  }) as F;
}
```

## Caso de uso 2 — extraer formas específicas

Imagina que tienes una discriminated union de eventos:

```ts
type Event =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'keypress'; key: string }
  | { kind: 'scroll'; delta: number };

type EventByKind<K extends Event['kind']> = Extract<Event, { kind: K }>;

type ClickEvent = EventByKind<'click'>;
//   ^? { kind: 'click'; x: number; y: number }
```

`Extract<Event, { kind: K }>` filtra los miembros de `Event` que tienen `kind: K`. Esto **es** un conditional type debajo (`T extends U ? T : never`).

Útil para handlers tipados:

```ts
type Handler<K extends Event['kind']> = (event: EventByKind<K>) => void;

const onClick: Handler<'click'> = (e) => {
  console.log(e.x, e.y); // e: ClickEvent — TS sabe que tiene x, y
};
```

## Caso de uso 3 — recursión

Los conditional types pueden recursar. Útil para tipos como "elimina todos los `null` y `undefined` profundamente":

```ts
type DeepNonNullable<T> = T extends object
  ? { [K in keyof T]: DeepNonNullable<NonNullable<T[K]>> }
  : NonNullable<T>;

type Original = {
  name: string | null;
  address: { street: string | undefined } | null;
};

type Clean = DeepNonNullable<Original>;
// {
//   name: string;
//   address: { street: string };
// }
```

TS limita la profundidad de recursión a ~50 niveles (depende de la versión). Para JSON anidado real, suficiente. Si pasas un tipo con ciclos (referencia a sí mismo), TS protesta. Solución: cortar la recursión a un nivel.

## Aplicado al repo — extraer tipos de Zod schemas

Ya viste `z.infer<typeof Schema>`. Por dentro es un conditional type. La idea:

```ts
// versión simplificada
type Infer<T> = T extends z.ZodType<infer Output> ? Output : never;

const UserSchema = z.object({ id: z.string(), name: z.string() });
type User = Infer<typeof UserSchema>; // { id: string; name: string }
```

Cuando ves `z.infer<typeof UserSchema>`, TS está extrayendo el `Output` del schema con un conditional + infer. La librería real es más sofisticada (maneja transforms, brands, optionals), pero el corazón es ese.

## Patrón avanzado — currying tipado

```ts
type Curry<F> = F extends (a: infer A, ...rest: infer R) => infer Ret
  ? R extends []
    ? (a: A) => Ret
    : (a: A) => Curry<(...args: R) => Ret>
  : never;

function add(a: number, b: number, c: number): number { return a + b + c; }

declare const curried: Curry<typeof add>;
curried(1)(2)(3); // ✅ tipado correctamente, número
curried(1, 2);    // ❌ unaria
```

No necesitas escribir esto en producción — librerías lo hacen por ti. Está aquí para que veas hasta dónde llega TS.

## Trampas comunes

1. **Olvidar la distribución y obtener `never` siempre**:
   ```ts
   type IsString<T> = T extends string ? true : false;
   type X = IsString<string | number>; // true | false  ← ¡no es boolean!
   ```
   `string | number` distribuye: el resultado es la unión de los resultados. Si querías un solo `boolean`, usa `[T] extends [string]` para no distribuir.

2. **Conditional types con uniones siempre dan uniones**:
   ```ts
   type R = string | number extends string ? 'a' : 'b'; // 'b'
   ```
   Espera, ¿no debería distribuir? **No**, porque `string | number` no es un type parameter "naked" — es un tipo concreto. La distribución solo aplica a parametros genéricos.

3. **Recursión sin caso base**:
   ```ts
   type Loop<T> = Loop<T>; // ❌ TS protesta inmediatamente
   ```
   TS detecta recursión infinita simple. La más sutil (recursión que no se reduce) la detecta tras unos cuantos niveles.

4. **`infer` solo dentro de `extends`**:
   ```ts
   type Bad<T> = (infer U)[]; // ❌
   ```
   Solo se permite en el lado izquierdo del `extends` de un conditional. Es la única posición sintáctica válida.

5. **Múltiples `infer` con la misma variable**:
   ```ts
   type SameType<T> = T extends [infer A, infer A] ? A : never;
   ```
   Si los dos `A` coinciden, da el tipo. Si no, da su unión:
   ```ts
   type X = SameType<[1, 2]>; // 1 | 2
   ```
   Esto es **intencional** y a veces lo que quieres. Cuando no, usa nombres distintos: `[infer A, infer B] extends [...]`.

6. **Performance**: conditional types complejos (especialmente con recursión) **ralentizan el compilador**. Si tu IDE empieza a ir lento, mira los tipos. Hay flags como `--extendedDiagnostics` para encontrar los culpables.

## Ejercicio

1. **Implementa `Awaited` simple**: `type Awaited<T> = T extends Promise<infer U> ? U : T`. Pruébalo con `Promise<string>`, `string`, `Promise<Promise<number>>`. ¿Qué pasa con el último? Mejora tu implementación para recursar.

2. **`PromiseValue` recursivo**: como el anterior pero recursivo — `PromiseValue<Promise<Promise<X>>>` debe dar `X`.

3. **`FirstParameter<F>`**: dado el tipo de una función, devuelve el tipo de su primer parámetro. Pista: `T extends (a: infer A, ...rest: any[]) => any ? A : never`.

4. **Tuple a unión**: implementa `type ToUnion<T extends readonly any[]> = T[number]`. Pruébalo con `['a', 'b', 'c'] as const`. No usa conditional types — es indexed access — pero te servirá en el doc 21.

5. **Reto — `RouteParams`**: usando template literal types (avance del doc 21), escribe `type Params<S extends string>` que extraiga los parámetros de una ruta tipo `/users/:id/posts/:postId`. Pista: necesitas distribución + recursión + template literals.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 50 — *Prefer Conditional Types to Overloaded Declarations*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/conditional-overload.md)** — caso de uso central de conditional types.
- **[Item 51 — *Prefer Using Generics over Inheritance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/inheritance.md)** — la mentalidad genérica vs OO.
- **[Item 52 — *Know How to Control the Distribution of Unions over Conditional Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/distribution.md)** — el comportamiento distributivo en detalle.
- **[Item 53 — *Use Template Literal Types to Model DSLs and Relationships Between Strings*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/template-literals.md)** — preview del doc 21.

---

**Anterior:** [19 — Generics avanzados](./19-generics-avanzados.md)
**Siguiente:** [21 — Template literal y mapped types](./21-template-literal-y-mapped-types.md)
