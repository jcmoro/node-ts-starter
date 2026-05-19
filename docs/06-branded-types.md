# 06 — Branded types

## El problema

TypeScript usa **tipado estructural**. Dos tipos con la misma forma son **intercambiables**, aunque tengan nombres distintos:

```ts
type UserId = string;
type Email  = string;

function deleteUser(id: UserId) { /* ... */ }

const email: Email = 'jose@example.com';
deleteUser(email); // ✅ TS lo acepta — y borra al usuario por su email
```

Para TS, `UserId` y `Email` son **alias** de `string`. No hay distinción real. Cualquier `string` puede pasarse a cualquier sitio que pida `UserId`.

> 💡 **Comparación**: en Java, `record UserId(String value)` te da un tipo nominal — `deleteUser(email)` no compila. En Go, `type UserID string` también es nominal: una conversión explícita es necesaria. **TS es estructural por diseño**, lo cual es flexible pero peligroso en dominios donde la identidad importa.

Esto es un bug esperando a pasar. ¿Y si quisieras forzar que **solo** un valor que ha pasado por validación de email pueda ser un `Email`? Con `type Email = string` no puedes.

## El truco: branded types

La idea: **añadir una propiedad fantasma** al tipo que no existe en runtime, solo a nivel de tipo. Es un "marcador" que distingue una cadena de otra.

```ts
type Email = string & { readonly __brand: 'Email' };
```

`Email` es ahora **una intersección**: `string` Y un objeto con `__brand: 'Email'`. Como ningún `string` plano tiene esa propiedad fantasma, TS los considera **incompatibles**:

```ts
const e: Email = 'foo';           // ❌ Property '__brand' is missing
const e: Email = 'foo' as Email;  // ✅ con assertion explícita
```

En runtime, el valor sigue siendo un `string` puro. La propiedad `__brand` **no se crea**. Es **purísimo type-level**. Por eso se llama "fantasma" o "phantom type".

## Implementación manual

Patrón base que verás en muchos proyectos:

```ts
// src/lib/brand.ts (ejemplo conceptual, no está en el repo)
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
```

Tres cosas:

1. **`unique symbol`** — el ID del brand es un símbolo único. Más estricto que un string literal: nadie puede crearlo accidentalmente desde fuera.
2. **`declare const`** — declaramos que existe a nivel de tipo, pero **nunca lo asignamos** en runtime. Si alguien intenta usar `__brand` como valor, el module compila a nada.
3. **`Brand<T, B>`** — genérico para cualquier tipo base (string, number…) y cualquier brand literal.

Y los brands en sí:

```ts
type Email  = Brand<string, 'Email'>;
type UserId = Brand<string, 'UserId'>;
type Age    = Brand<number, 'Age'>;
```

## Smart constructors

Si no puedes crear un `Email` con un cast normal, ¿cómo creas uno legítimamente? Con una **función constructora** que valida y devuelve el tipo:

```ts
function makeEmail(raw: string): Email | null {
  return /^[^@]+@[^@]+\.[^@]+$/.test(raw) ? (raw as Email) : null;
}

const maybeEmail = makeEmail(userInput);
if (maybeEmail) {
  deleteUser(maybeEmail); // ❌ deleteUser pide UserId, no Email — TS protesta
  sendEmailTo(maybeEmail); // ✅
}
```

El `as Email` está **dentro** de `makeEmail`. Es el **único sitio** donde haces el cast — y solo lo haces después de validar. Fuera de esa función, nadie puede crear un `Email` sin pasar por el validador.

Esto se llama **smart constructor pattern**. La idea de fondo:

> Si tienes un valor del tipo `Email`, **garantizado que pasó la validación**. No tienes que volver a comprobarlo.

> 💡 **Comparación Java**: como una clase con constructor privado que solo se accede vía factory method que valida. La diferencia: en TS, **cero overhead en runtime** — no hay clase, no hay objeto, sigue siendo un `string`.

## Integración con Zod

Zod tiene soporte nativo de brands. En vez de hacerlo manual, declaras el brand al final del schema:

```ts
import { z } from 'zod';

const EmailSchema = z.string().email().brand<'Email'>();
type Email = z.infer<typeof EmailSchema>;
//   ^? string & z.BRAND<'Email'>
```

Y ahora:

```ts
const result = EmailSchema.safeParse('jose@example.com');
if (result.success) {
  const e: Email = result.data; // ✅ es un Email, validado
}

const raw: string = 'plain string';
const e2: Email = raw; // ❌ no compila — falta el brand
```

**El validador es el constructor**. No hay cast manual en tu código. Si quieres un `Email`, **pásalo por el schema**.

> 💡 **Por qué esto es bonito**: con Zod, ya estabas validando datos del borde. El brand viene "gratis" — solo añades `.brand<'X'>()` al final. El validador hace el cast por ti, dentro, una vez, en el sitio correcto.

## Refactor del repo

Vamos a aplicar esto al proyecto. Hasta ahora:

```ts
// src/app.ts (antes)
const CreateUser = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});
```

`parsed.data.email` era un `string`. Cualquiera podría pasarlo a una función que espera, digamos, un `UserId`. **No hay distinción semántica**.

Después del refactor, en `src/domain/user.ts`:

```ts
import { z } from 'zod';

export const EmailSchema = z.string().email().brand<'Email'>();
export type Email = z.infer<typeof EmailSchema>;

export const UserIdSchema = z.string().uuid().brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

export const NonEmptyStringSchema = z.string().min(1).brand<'NonEmptyString'>();
export type NonEmptyString = z.infer<typeof NonEmptyStringSchema>;

export const CreateUserSchema = z.object({
  email: EmailSchema,
  name: NonEmptyStringSchema,
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UserSchema = z.object({
  id: UserIdSchema,
  email: EmailSchema,
  name: NonEmptyStringSchema,
});
export type User = z.infer<typeof UserSchema>;

export function newUserId(): UserId {
  return crypto.randomUUID() as UserId;
}
```

Tres cosas a notar:

1. **El schema vive en `domain/`**, no junto al handler. El dominio es **independiente del transporte HTTP**. Un día podríamos consumir Kafka y reutilizar el mismo schema.

2. **`NonEmptyString` como brand reutilizable**. No es solo para `name`. Cualquier campo que necesite "string con al menos un carácter" puede usar este schema. **DRY a nivel de tipos**.

3. **`newUserId()` con cast explícito**. `crypto.randomUUID()` devuelve un `string` válido por construcción — no tiene sentido pasarlo por el schema (paranoia inútil). Casteamos dentro del helper, que documenta intent y centraliza el casting en un solo sitio.

Y en `src/app.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { CreateUserSchema, newUserId } from './domain/user.ts';

export const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/users', async (c) => {
  const body = await c.req.json();
  const parsed = CreateUserSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const user = { id: newUserId(), ...parsed.data };
  return c.json(user, 201);
});
```

Ahora `user.email` es `Email`, `user.name` es `NonEmptyString`, `user.id` es `UserId`. Si en algún momento alguien intenta:

```ts
deleteUserById(user.email); // ❌ Argument of type 'Email' is not assignable to 'UserId'
```

TS lo caza.

## Comparación con otros lenguajes

| Lenguaje | Cómo se hace                                            | Overhead runtime          |
|----------|---------------------------------------------------------|---------------------------|
| Java     | `record UserId(String value)` + factory                 | Heap allocation por valor |
| Go       | `type UserID string` + funciones con tipo               | Cero                      |
| Python   | `UserId = NewType('UserId', str)` (mypy lo trata como nominal) | Cero (es solo mypy)  |
| Rust     | `struct UserId(String);` (newtype pattern)              | Cero                      |
| TS       | Branded type (phantom property)                         | Cero                      |

TS está más cerca de Go/Rust que de Java: **cero overhead en runtime**, distinción puramente compile-time. La diferencia con Go es que en Go necesitas conversión explícita `UserID(s)`, mientras que en TS necesitas asegurarte de que el cast viva dentro de un constructor controlado (o un schema Zod).

## Trampas comunes

### 1. Brand uniqueness — strings literales colisionan

```ts
type EmailA = string & { __brand: 'Email' };
type EmailB = string & { __brand: 'Email' };
// EmailA y EmailB son el MISMO tipo. ¿Qué brand "gana"?
```

Si dos brands distintos comparten el mismo string literal, son intercambiables. Solución: **convención** (siempre usa un literal único y descriptivo: `'UserId'`, no `'Id'`) o **`unique symbol`** (más estricto pero más verboso).

Zod usa `unique symbol` internamente — está protegido.

### 2. El cast no valida

```ts
const fake: Email = 'not an email' as Email; // ✅ TS compila
```

El cast `as` es una **promesa al compilador**. TS te cree. Si mientes, en runtime el `Email` contiene basura. **Por eso los casts solo deben vivir dentro de validadores**.

### 3. Imposible distinguir brands en runtime

```ts
function isEmail(x: unknown): x is Email {
  return typeof x === 'string' && /@/.test(x); // 🤔 ¿basta esto?
}
```

En runtime, un `Email` es un `string`. Para verificar que un valor "es Email", **necesitas la lógica de validación** (regex, schema, etc.). El brand **no existe** para hacer `instanceof`. No te confundas: el brand es contrato compile-time, no marcador runtime.

### 4. `JSON.stringify` no preserva brands

Obvio cuando lo piensas, pero sorprende: serializas un `Email`, recibes un `string`. Cuando deserialices, vas a tener que **re-parsear** por el schema para volver a tener un `Email`. **Esto es lo correcto** — el JSON viene del exterior, no confías en él.

### 5. Caer en branditis

No todo necesita brand. Pregúntate: **¿hay daño real si alguien pasa un `string` cualquiera en vez de este valor?** Si la respuesta es "no, solo lo usaríamos para logging", probablemente no merece la pena. Brands tienen sentido en:

- **IDs** (`UserId` vs `OrderId` — confundirlos es desastre).
- **Datos validados** (`Email`, `URL`, `PositiveInt`).
- **Unidades** (`Cents` vs `Euros`, `Meters` vs `Feet`).
- **Datos "limpiados"** (`SanitizedHtml` vs `RawHtml`).

No tienen sentido para variables internas, params de helpers privados, etc.

## Patrón avanzado: brands con datos validados

A veces el brand no solo dice "es un email", sino "es un email **normalizado**" (lowercased, trimmed):

```ts
const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .brand<'Email'>();
```

Ahora cualquier `Email` que tengas en el sistema **está garantizadamente normalizado**. No más bugs de "Jose@Example.com" vs "jose@example.com" en comparaciones.

Esto es el principio "parse, don't validate" del capítulo 03 llevado al extremo: el tipo no solo dice "es válido", dice "está en forma canónica".

## Composición con `as const` y `readonly`

Los branded types se llevan especialmente bien con dos herramientas que **estrechan** el tipo: `as const` y `readonly`. Juntos te dan valores **inmutables** y **literales** — útiles para constantes de dominio.

### `as const` — convertir a literales y readonly

Sin `as const`, los literales se "widenan" a su tipo base:

```ts
const colors = ['red', 'green', 'blue'];
//    ^? string[]

const point = { x: 1, y: 2 };
//    ^? { x: number; y: number }
```

Con `as const`, TS preserva los valores **exactos** y marca todo como `readonly`:

```ts
const colors = ['red', 'green', 'blue'] as const;
//    ^? readonly ['red', 'green', 'blue']

const point = { x: 1, y: 2 } as const;
//    ^? { readonly x: 1; readonly y: 2 }
```

Tres cambios sobre el tipo inferido:
1. **Literales en vez de tipos base** (`'red'`, no `string`).
2. **Tuples en vez de arrays** (`['a', 'b']`, no `string[]`).
3. **`readonly` propagado** a todas las propiedades.

### Patrón: uniones literales sin enum

Para un campo que solo puede tener N valores, en lugar de `enum`:

```ts
const ROLES = ['admin', 'user', 'guest'] as const;
type Role = typeof ROLES[number];
//   ^? 'admin' | 'user' | 'guest'

function hasAccess(role: Role): boolean { /* ... */ }
hasAccess('admin'); // ✅
hasAccess('root');  // ❌ Argument of type '"root"' is not assignable
```

`typeof ROLES[number]` es la idiomática para "todos los elementos del array como union". Sin `as const`, `ROLES[number]` sería `string` y perderías el cierre.

> 💡 **Por qué no `enum`**: los `enum` de TS tienen problemas (no son tree-shakeable, emiten runtime, son nominales lo cual sorprende en un sistema estructural). `as const` + union es **lo idiomático en TS moderno**.

### Composición con brands

```ts
const VALID_STATUSES = ['pending', 'success', 'error'] as const;
type Status = typeof VALID_STATUSES[number];

const StatusSchema = z.enum(VALID_STATUSES).brand<'Status'>();
type BrandedStatus = z.infer<typeof StatusSchema>;
//   ^? ('pending' | 'success' | 'error') & z.BRAND<'Status'>
```

Un único array `VALID_STATUSES` te da:
- Un valor que puedes recorrer en runtime.
- Un type `Status` para anotar parámetros.
- Un schema Zod que valida.
- Un brand para distinguirlo de cualquier otro string.

**Una sola fuente de verdad.** Si añades `'archived'` al array, los cuatro derivados se actualizan.

### `readonly` arrays vs `readonly` propiedades

Atención a la distinción:

```ts
// readonly de propiedad — no puedes reasignar
type A = { readonly id: string };
const a: A = { id: '1' };
a.id = '2'; // ❌

// readonly array — array no se puede mutar
type B = readonly string[];
const b: B = ['a', 'b'];
b.push('c');  // ❌ Property 'push' does not exist on type 'readonly string[]'
b[0] = 'x';   // ❌ Index signature is readonly
```

Y la forma tuple:

```ts
type Pair = readonly [string, number];
const p: Pair = ['Jose', 30];
p[0] = 'Maria'; // ❌
```

`readonly` no es contagioso por defecto — un `readonly { user: User }` no implica `User` readonly. Para profundidad, necesitas `DeepReadonly` (ver doc 21) o `as const` en el valor concreto.

### Readonly como contrato de API

Un patrón muy útil: tu función devuelve `readonly` para señalar "no mutes esto":

```ts
function getActiveUsers(): readonly User[] {
  return cache.users.filter(u => u.active);
}

const users = getActiveUsers();
users.push(newUser); // ❌ — el caller no puede mutar el array
```

Aunque internamente el array sea mutable, la firma comunica intent. Es contrato unilateral — TS no impide que el implementador mute el array que devuelve, pero el caller queda protegido.

### Brands + readonly + as const — combinado

Ejemplo real para el repo:

```ts
// src/domain/permissions.ts (conceptual)
export const PERMISSIONS = [
  'read:users',
  'write:users',
  'read:orders',
  'write:orders',
] as const;

export type Permission = typeof PERMISSIONS[number];

export const PermissionSchema = z.enum(PERMISSIONS).brand<'Permission'>();
export type BrandedPermission = z.infer<typeof PermissionSchema>;

export function hasPermission(
  user: User,
  required: readonly BrandedPermission[],
): boolean {
  return required.every(p => user.permissions.includes(p));
}
```

`hasPermission` recibe un `readonly BrandedPermission[]`. El caller no puede confundir un `string[]` con permisos válidos, y la función no puede mutar el array. Garantías de ambos lados, **cero overhead runtime**.

### Trampas con `as const`

1. **`as const` solo aplica al literal**, no se propaga:
   ```ts
   const a = { name: 'Jose' } as const;
   const b = { user: a };
   //    ^? { user: { readonly name: 'Jose' } }
   // pero b.user no es readonly
   ```
   Para readonly en profundidad, `as const` debe estar en el literal exterior.

2. **`as const` con cómputo**:
   ```ts
   const x = ('hello' + ' world') as const; // ❌
   ```
   Solo funciona sobre literales sintácticos, no expresiones computadas.

3. **`readonly` no migra a JSON**: si serializas un objeto readonly y lo deserializas, el resultado **no** tiene readonly. Re-parsea con tu schema para recuperar las garantías.

## Ejercicio

1. **Refactoriza un nuevo campo**: añade `age` al `CreateUserSchema` como `PositiveInt = z.number().int().positive().brand<'PositiveInt'>()`. Comprueba con `npm run typecheck` que `parsed.data.age` tiene tipo `PositiveInt`.

2. **Función que solo acepta `UserId`**: crea `function deleteUser(id: UserId): void {}` en `src/domain/user.ts`. Intenta llamarla con un `string` plano dentro de `app.ts`. ¿Qué error sale? Arréglalo pasando el string por `UserIdSchema.parse(...)`.

3. **Brand sin Zod**: implementa a mano un brand `type Cents = ...` y dos helpers: `cents(n: number): Cents` y `add(a: Cents, b: Cents): Cents`. Confirma que `add(cents(100), 50)` no compila pero `add(cents(100), cents(50))` sí.

4. **Reto type-level**: usando el truco del capítulo 05 (`Expect<Equal<X, Y>>`), demuestra que `Email` y `string` **no son** asignables entre sí. Pista: `Equal<Email, string>` debería dar `false`.

5. **Lee Zod's `BRAND`** (https://github.com/colinhacks/zod/blob/main/src/types.ts, busca "BRAND"). Verás `declare const BRAND: unique symbol` y el truco completo. Vale la pena 10 minutos para ver el patrón sin azúcar.

6. **`as const` + brand**: crea `const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const`, deriva `Environment` con `typeof ENVIRONMENTS[number]`, y branda con Zod. Usa `EnvironmentSchema.parse(process.env.NODE_ENV)` para validar el entorno al arrancar. Comprueba que `EnvironmentSchema.options` te devuelve el array original.

7. **`readonly` como contrato**: cambia la firma de algún helper que devuelva un array a `readonly Foo[]`. Intenta hacer `.push()` en el caller. Observa qué métodos siguen disponibles (`map`, `filter`, `find`, `slice`) y cuáles no (`push`, `pop`, `sort`, `splice`). ¿Por qué `.sort()` no? Pista: muta in-place.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 4 — *Get Comfortable with Structural Typing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-intro/structural.md)** — el problema que los brands resuelven. Si entiendes por qué TS acepta `Email` donde se pide `UserId` (porque ambos son `string`), entiendes por qué necesitamos el truco.
- **[Item 14 — *Use `readonly` to Avoid Errors Associated with Mutation*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-types/readonly.md)** — readonly como contrato de API y composición con brands.
- **[Item 35 — *Prefer More Precise Alternatives to String Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/avoid-strings.md)** — la motivación general: cualquier `string` es demasiado permisivo en un sistema con dominio.
- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — `Email`, `UserId`, `NonEmptyString` no son nombres técnicos; son palabras del dominio. Esa es la regla.
- **[Item 64 — *Consider Brands for Nominal Typing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/brands.md)** — **el capítulo paralelo del libro**. Está dedicado entero a esta técnica. Lectura obligada después del nuestro.

---

**Anterior:** [05 — Testing con `node --test`](./05-testing-node-test.md)
**Siguiente:** [07 — Servicios y repositorios](./07-servicios-y-repositorios.md)
