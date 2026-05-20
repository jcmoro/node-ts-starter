# 19 — Generics avanzados

## El problema

Los generics básicos ya los usas: `Array<T>`, `Promise<T>`, `Result<T, E>`. La parte interesante de TS empieza cuando los generics tienen **restricciones**, **defaults**, e interactúan con la inferencia de formas no obvias.

Tres preguntas que vamos a contestar:

1. ¿Cómo digo "este genérico debe ser un objeto con cierta forma" (no `any`)?
2. ¿Por qué a veces TS infiere demasiado y otras veces no infiere nada?
3. ¿Por qué `Array<Dog>` es asignable a `Array<Animal>` pero `(a: Animal) => void` **no** es asignable a `(a: Dog) => void`? (varianza)

## Constraints — `extends`

Un generic sin constraint acepta cualquier cosa, incluyendo cosas que no quieres:

```ts
function getProp<T>(obj: T, key: string) {
  return obj[key]; // ❌ Element implicitly has an 'any' type
}
```

TS no sabe que `obj` tiene índice. Hay que decírselo:

```ts
function getProp<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]; // ✅
}

const user = { name: 'Jose', age: 30 };
getProp(user, 'name'); // string
getProp(user, 'age');  // number
getProp(user, 'foo');  // ❌ Argument of type '"foo"' is not assignable
```

Tres constraints encadenados:
- `T extends object` — `T` debe ser un objeto.
- `K extends keyof T` — `K` debe ser una clave existente de `T`.
- Retorno `T[K]` — **indexed access type**: el tipo del valor en esa clave.

> 💡 **Analogía Java**: `<T extends Comparable<T>>`. Idea idéntica. La diferencia: en TS, las constraints son estructurales — "que tenga este shape", no "que implemente esta interface por nombre".

### Constraint con shape

```ts
type WithId = { id: string };

function logId<T extends WithId>(x: T) {
  console.log(x.id);
}
```

Cualquier objeto con `id: string` cuela, sin importar qué otras propiedades tenga. Esto es **mejor que** `function logId(x: WithId)` cuando quieres preservar el tipo concreto:

```ts
function withTimestamp<T extends WithId>(x: T): T & { ts: number } {
  return { ...x, ts: Date.now() };
}

const r = withTimestamp({ id: '1', name: 'Jose' });
//    ^? { id: string; name: string } & { ts: number }  ← preserva 'name'
```

Si en vez de `<T extends WithId>` hubieras puesto `(x: WithId)`, el retorno sería `WithId & { ts: number }` — perderías `name`.

## Default generic parameters

Ya lo viste en `Result<T, E = Error>`. Permite que el usuario omita el genérico:

```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

const a: Result<User> = ok(user);              // E = Error
const b: Result<User, NotFoundError> = err(e); // E explícito
```

Útil cuando hay un caso común que quieres que sea conciso. Sin abuso: si los usuarios casi siempre proporcionan el parámetro, el default es ruido.

Otro patrón: **defaults que dependen de otros parámetros**:

```ts
type Repository<T, ID = T extends { id: infer I } ? I : string> = {
  findById(id: ID): Promise<T | null>;
  save(entity: T): Promise<T>;
};

type User = { id: number; name: string };
type UserRepo = Repository<User>; // ID = number (inferido del campo id)
```

Esto ya usa **conditional types** + `infer` — lo veremos a fondo en el doc 20. Aquí solo nota que los defaults pueden ser **computados**, no solo constantes.

## Inferencia: dónde el compilador deduce y dónde se rinde

```ts
function identity<T>(x: T): T {
  return x;
}

identity(42);       // T = number (inferido)
identity<string>(42); // ❌ explícito y mal tipado
```

TS infiere `T` desde los **argumentos**. Reglas mentales:

1. **Posición covariante** (argumentos, retornos en lectura): TS infiere el tipo más específico.
2. **Posición contravariante** (parámetros que tu función pasa a callbacks): TS infiere el más general.
3. **Múltiples sitios de inferencia**: TS busca un tipo que satisfaga todos.

Donde se rinde:

```ts
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  // ...
}

const u = { name: 'Jose', age: 30, email: 'x@y.z' };
const r = pick(u, ['name', 'age']);
//   ^? { name: string; age: number }
```

Si llamas `pick(u, [])`, `K` se infiere como `never` y obtienes `{}`. No es un error, es la inferencia siendo coherente.

### El truco `NoInfer<T>`

A veces quieres que TS infiera `T` desde un argumento **pero ignore** otro:

```ts
function compare<T>(a: T, b: NoInfer<T>): boolean {
  return a === b;
}

compare('hello', 42); // ❌ T se infiere desde 'a' = 'hello', y 42 no encaja
```

Sin `NoInfer`, TS uniría los dos: `T = string | number`. Con `NoInfer<T>` en la posición de `b`, TS solo mira `a`. Útil para APIs donde quieres marcar un "argumento canónico" del que se debe inferir.

`NoInfer` es nativo desde TS 5.4.

## Generics en tipos vs en funciones

Hay una distinción que sorprende viniendo de Java:

```ts
// Genérico de función: cada llamada elige T
function wrap<T>(x: T): { value: T } {
  return { value: x };
}

// Genérico de tipo: se decide al instanciar el tipo
type Wrap<T> = { value: T };
```

Diferencia práctica: las funciones genéricas se **especializan** en cada llamada. Los tipos genéricos solo existen cuando los usas.

```ts
type Box = Wrap<number>;       // se "instancia" aquí, ya no es genérico
const b: Box = { value: 42 };

const fn = <T>(x: T) => ({ value: x });
// fn sigue siendo genérico hasta que se llama
```

> 💡 **Analogía Java**: como diferencia entre `class Box<T>` (genérico instanciable) y un método `<T> T identity(T x)` (genérico de invocación). En TS los dos coexisten en sintaxis muy parecida.

## Varianza: cuándo `Foo<A>` es subtipo de `Foo<B>`

Este es el tema que más confusión genera viniendo de Java. La pregunta:

> Si `Dog extends Animal`, ¿es `Foo<Dog>` subtipo de `Foo<Animal>`?

Depende de **cómo se use `T` dentro de `Foo`**.

### Covarianza — `T` en posición de salida

Si `T` aparece como **valor producido** (return, propiedad de lectura, elemento de array):

```ts
type Producer<T> = { get(): T };

declare let pa: Producer<Animal>;
declare let pd: Producer<Dog>;

pa = pd; // ✅ un productor de Dog ES un productor de Animal
```

Si te entrega un Dog, te entrega un Animal (Dog ES Animal). **Covariante**: la jerarquía se mantiene.

### Contravarianza — `T` en posición de entrada

Si `T` aparece como **valor consumido** (parámetro):

```ts
type Consumer<T> = { take(x: T): void };

declare let ca: Consumer<Animal>;
declare let cd: Consumer<Dog>;

ca = cd; // ❌ un consumidor de Dog NO acepta cualquier Animal
cd = ca; // ✅ un consumidor de Animal acepta también un Dog
```

Si tu función pide cualquier `Animal`, puede comerse un `Dog`. Lo contrario no funciona — `cd` solo sabe manejar perros. **Contravariante**: la jerarquía se invierte.

### Bivarianza (la trampa de TS)

```ts
type Callback<T> = (x: T) => void;

declare let cba: Callback<Animal>;
declare let cbd: Callback<Dog>;

cba = cbd; // ✅ TS lo acepta (¡pero matemáticamente debería ser ❌!)
```

Por compatibilidad histórica con JS, TS permite asignar callbacks en ambas direcciones para tipos `function`. Esto es **bivarianza**, y es **incorrecto** desde el punto de vista de tipos. Solución: declarar la callback como **método** (con `method` syntax) en lugar de propiedad-función:

```ts
type Callback<T> = { call(x: T): void }; // contravariante estricto
```

Con `strictFunctionTypes` (parte de `strict`, **activado** en nuestro tsconfig), TS aplica contravarianza correcta para **funciones declaradas como propiedades** `(x: T) => void` pero **no** para shorthand `method(x: T): void`. Es una distinción sutil pero importante.

> 💡 **Comparación**: Java tiene `? extends T` (covariante) y `? super T` (contravariante) que tienes que poner a mano. TS lo deduce de cómo uses `T`. Más limpio, pero requiere saber de varianza para entender qué pasa.

### Anotaciones de varianza explícita

TS 4.7 introdujo `out` / `in` para forzar varianza en tipos:

```ts
type Producer<out T> = { get(): T };          // covariante explícito
type Consumer<in T> = { take(x: T): void };   // contravariante explícito
type Invariant<in out T> = { both(x: T): T }; // invariante
```

Sirven sobre todo como **assertions de diseño**: si alguien añade un uso de `T` que rompa la varianza declarada, TS protesta. No los necesitas a diario.

## Patrón: function factory con generics

Ejemplo realista para este repo — un constructor de repositorios genéricos:

```ts
// src/lib/repository.ts (conceptual)
import { type Result, ok, err } from './result.ts';

type WithId<ID> = { id: ID };

export function makeRepository<T extends WithId<ID>, ID = string>(
  table: string,
) {
  return {
    async findById(id: ID): Promise<Result<T | null, Error>> {
      // SQL contra `table` filtrando por id
      return ok(null);
    },
    async save(entity: T): Promise<Result<T, Error>> {
      return ok(entity);
    },
  };
}

const userRepo = makeRepository<User>('users');
// userRepo.findById(...) devuelve Result<User | null, Error>
```

Cosas a notar:

1. **`T extends WithId<ID>`** — restringimos `T` a "algo con un id del tipo ID". Sin esto, `T` podría ser un string suelto.
2. **`ID = string`** — default. Si el ID no es string, el caller lo declara: `makeRepository<Order, OrderId>('orders')`.
3. **El retorno es inferido**: TS sabe que `findById` devuelve `Promise<Result<User | null, Error>>` sin necesidad de tipar la firma de la función factory.

## Trampas comunes

1. **Olvidar `extends` y usar `any`**:
   ```ts
   function getProp<T, K>(obj: T, key: K): any { /* ... */ }
   ```
   El retorno `any` envenena el caller. Mejor `T[K & keyof T]` o un `extends keyof T` en la constraint.

2. **Sobre-genericar**:
   ```ts
   function sum<T extends number>(a: T, b: T): T { return (a + b) as T; }
   ```
   ¿Por qué `<T extends number>` si el cuerpo solo trabaja con `number`? Quita el generic. La regla: si el genérico no aparece **en al menos dos sitios** distintos de la firma, probablemente no lo necesitas.

3. **Constraint sobre `string`** + literal:
   ```ts
   function tag<T extends string>(s: T): `tagged:${T}` { /* ... */ }
   tag('hello'); // T = 'hello' (literal), no string
   ```
   Útil. Pero si llamas con una variable `string`, pierdes el literal:
   ```ts
   const s: string = 'hello';
   tag(s); // T = string, retorno: `tagged:${string}`
   ```
   Considera `<const T extends string>` (TS 5.0+) para forzar inferencia literal.

4. **`keyof` sobre tipos vacíos**:
   ```ts
   type K = keyof {}; // K = never
   ```
   Si pasas un objeto vacío como `T`, `keyof T = never`. Tu API se vuelve inusable. Solución: añade una constraint que prevenga el vacío.

5. **Generics que parecen pero no son polimórficos**:
   ```ts
   type Pair<T> = [T, T];
   const p: Pair<string | number> = ['a', 42]; // ✅
   ```
   Esto **no** garantiza que los dos elementos sean del mismo tipo runtime — solo que **el tipo del par** es la unión. Si querías "ambos del mismo tipo concreto", necesitas resolver `T` en una llamada de función, no en una anotación.

## Ejercicio

1. **`pluck`**: implementa `function pluck<T, K extends keyof T>(arr: T[], key: K): T[K][]`. Aplica a un array de `User` para extraer todos los `email`. Comprueba que el retorno tiene tipo `Email[]` (con brand).

2. **`mergeWithDefaults`**: escribe `function mergeWithDefaults<T extends object>(value: Partial<T>, defaults: T): T`. Pista: `T extends object`, no `T`.

3. **Varianza en práctica**: declara `type Handler<T> = { handle(x: T): void }`. Crea un `Handler<Animal>` y un `Handler<Dog>`. ¿Cuál puede asignarse al otro? Verifica con TS. Luego cambia a `type Handler<T> = (x: T) => void` y ve qué cambia con `strictFunctionTypes`.

4. **NoInfer**: escribe `function repeat<T>(value: T, count: number, sep: NoInfer<T>): T[]`. Confirma que `repeat('a', 3, 1)` falla por `T = string`, no por la unión `string | number`.

5. **Reto — factory tipada**: amplía `makeRepository` para que acepte un schema Zod (`schema: z.ZodType<T>`) y use `.parse` para validar antes de devolver. La firma debe garantizar que `T` y el schema están alineados.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 26 — *Use Functional Constructs and Libraries to Help Types Flow*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/functional.md)** — cómo el estilo funcional ayuda a la inferencia.
- **[Item 50 — *Prefer Conditional Types to Overloaded Declarations*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/conditional-overload.md)** — generics + conditional types vs overloads.
- **[Item 51 — *Prefer Using Generics over Inheritance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/inheritance.md)** — cuándo un genérico reemplaza una jerarquía de clases.
- **[Item 52 — *Know How to Control the Distribution of Unions over Conditional Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-generics/distribution.md)** — la sutileza distributiva (lo verás en el doc 20).

---

**Anterior:** [18 — Narrowing y type guards](./18-narrowing-y-type-guards.md)
**Siguiente:** [20 — Conditional types e `infer`](./20-conditional-types-e-infer.md)
