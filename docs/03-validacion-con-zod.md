# 03 — Validación con Zod

## El problema

Repite conmigo: **los tipos de TypeScript no existen en runtime**.

```ts
function greet(name: string) {
  return `Hola, ${name.toUpperCase()}`;
}

// En el código que tú escribes, TS te protege:
greet(42);          // ❌ error de compilación

// Pero esto es lo que llega de un POST:
const body = await req.json();  // tipo: any (o unknown, mejor)
greet(body.name);    // ✅ compila — pero si name no es string, BOOM en runtime
```

En el **borde del sistema** (HTTP requests, variables de entorno, lecturas de DB, archivos, mensajes de cola) los datos llegan **sin tipo**. TS no sabe lo que son. Si te limitas a hacer `as string`, estás **mintiendo** al compilador.

Necesitas algo que:

1. **Valide en runtime** que el dato tiene la forma esperada.
2. **Te dé el tipo** estático correspondiente, sin tener que declararlo dos veces.

Eso es **Zod** (y similares: Valibot, ArkType, io-ts…). En este proyecto usamos Zod por popularidad y compatibilidad con Hono.

## La idea central de Zod

**Defines un schema, obtienes ambas cosas**: el validador y el tipo.

```ts
import { z } from 'zod';

const User = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

type User = z.infer<typeof User>;
// equivale a: { email: string; name: string }
```

Mira el patrón: **declaras el schema una vez** y el tipo se **infiere** con `z.infer<typeof X>`. Si mañana añades un campo al schema, el tipo se actualiza solo. Esto se llama "single source of truth" — los tipos derivan del schema, no al revés.

> 💡 **Analogía Python**: idéntico a [Pydantic](https://docs.pydantic.dev/). Defines un `BaseModel`, validas con él, y la clase es a la vez el tipo.
>
> 💡 **Analogía Java**: como Bean Validation (`@NotNull`, `@Email`) pero con inferencia. En Java declaras la clase Y las anotaciones; en TS con Zod el schema **es** la clase.
>
> 💡 **Analogía Go**: no hay equivalente directo. Lo más cercano sería una función `Decode(raw []byte) (User, error)` escrita a mano, donde `User` es un struct con tags `validate:"required"`.

## `parse` vs `safeParse`

Zod ofrece dos APIs:

### `parse` — throws

```ts
const user = User.parse(body); // si falla, throw ZodError
```

Estilo excepción. Sirve si vas a dejar que un middleware/handler global capture el error. Conciso, pero si te olvidas del try/catch, peta el proceso.

### `safeParse` — devuelve un Result

```ts
const result = User.safeParse(body);

if (!result.success) {
  // result.error es un ZodError
  return c.json({ error: z.treeifyError(result.error) }, 400);
}

// Aquí TS sabe que result.data es User
const user = result.data;
```

Estilo Result/Either. **Esto te va a sonar al capítulo 04** — porque es exactamente la misma idea (`{ success: true; data } | { success: false; error }`) con narrowing por el discriminante `success`.

**Recomendación general**: `safeParse` en los handlers HTTP (errores son normales y esperados, no excepciones), `parse` en código donde un fallo es un bug del programador (config inicial, fixtures de test).

En `src/env.ts` usamos `safeParse` para poder dar un error de arranque claro:

```ts
const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;
```

## El patrón `env.ts` paso a paso

Abre `src/env.ts` y léelo con esto:

```ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
```

Tres cosas a notar:

1. **`z.enum([...])`** genera un union literal type: `'development' | 'test' | 'production'`. Mucho más útil que `z.string()`.
2. **`z.coerce.number()`** convierte el string del `process.env` a número antes de validar. Sin `coerce`, fallaría porque `process.env.PORT` es siempre `string`.
3. **`.default(...)`** se aplica si el valor es `undefined`. Te ahorra fallbacks manuales.

El resto del archivo:

```ts
const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;
```

**Por qué `process.exit(1)`**: si la config es inválida, **no queremos arrancar** un servidor medio-roto. Fallar rápido en arranque es muchísimo mejor que descubrirlo al primer request a las 3am.

`treeifyError` formatea el `ZodError` como un árbol legible, mucho mejor que el JSON crudo:

```
{
  "NODE_ENV": { "_errors": ["Invalid enum value..."] },
  "PORT": { "_errors": ["Expected number, received nan"] }
}
```

## Validación en handlers HTTP

En `src/index.ts`:

```ts
const CreateUser = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

app.post('/users', async (c) => {
  const body = await c.req.json();         // tipo: unknown
  const parsed = CreateUser.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  // parsed.data es CreateUser, tipado al 100%
  return c.json({ id: crypto.randomUUID(), ...parsed.data }, 201);
});
```

Patrón clave: el `if (!parsed.success) return ...` **narrowea** el tipo. Después del `if`, TS sabe que `parsed.success === true`, y por tanto `parsed.data` existe y tiene el tipo correcto. Esto es **discriminated union narrowing** — protagonista del capítulo 04.

> 💡 **Idiomático**: Hono tiene un middleware oficial (`@hono/zod-validator`) que esconde este boilerplate. Lo usaremos más adelante; por ahora dejamos la validación manual para ver el patrón completo.

## El zen de Zod: validar en el borde, no en cada función

```ts
// ❌ no hagas esto
function processUser(raw: unknown) {
  const user = User.parse(raw);
  // ... lógica ...
}

// ✅ haz esto
function processUser(user: User) {
  // ... lógica, asumiendo que ya está validado ...
}

// Y en el handler:
const user = User.parse(body);
processUser(user);
```

Validas **una vez**, en el borde de tu sistema. A partir de ahí, mueves valores tipados. Si una función recibe un `User`, **confía** en que es un `User`. No revalides.

Esto es la regla de oro: **"parse, don't validate"** ([Alexis King](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)). En vez de tener funciones que comprueban si algo es válido, tienes funciones que **convierten lo desconocido en lo conocido**.

## Trampas comunes

1. **Olvidar `z.coerce` con strings de entorno.** `PORT=3000` es `"3000"` (string), no `3000`. Sin coerce, `z.number()` falla.
2. **Usar `as` para hacer trampa.** Si tienes `body as User`, no has validado nada — TS te cree. Cuando esté mal, falla en runtime.
3. **Validar en demasiados sitios.** Si en cada función pasas el dato por un schema, pierdes rendimiento y la lógica se vuelve ruido. Una vez en el borde, basta.
4. **Confundir `nullable` con `optional`.**
   - `z.string().optional()` → `string | undefined` (la propiedad puede no estar).
   - `z.string().nullable()` → `string | null` (la propiedad está pero su valor puede ser null).
   - Pueden combinarse: `.optional().nullable()`.
5. **No leer `treeifyError`.** Cuando una validación falla, ese tree es oro. Aprende a leerlo.

## Comparación rápida con alternativas

| Librería    | Pros                                       | Contras                                |
|-------------|--------------------------------------------|----------------------------------------|
| **Zod**     | Popular, ecosistema enorme, API agradable  | Bundle grande, inferencia lenta en schemas muy grandes |
| **Valibot** | Tree-shakable, mucho más ligero            | API menos pulida, menos ecosistema     |
| **ArkType** | Sintaxis tipo TS literal (`'string > 0'`)  | Conceptualmente más exigente           |
| **io-ts**   | Funcional puro, integra con fp-ts          | API menos amigable, comunidad menor    |

Para aprender: Zod. Para producción frontend con bundle crítico: considera Valibot. Para amantes de fp: io-ts.

## Ejercicio

1. **Añade campos al schema `CreateUser`** en `src/index.ts`:
   - `age`: número entero, opcional, entre 0 y 150.
   - `role`: enum `'admin' | 'user'`, default `'user'`.

   Comprueba con `npm run typecheck` que el tipo inferido en `parsed.data` se actualiza solo.

2. **Prueba el endpoint** con `curl`:
   ```bash
   curl -X POST http://localhost:3000/users \
     -H 'Content-Type: application/json' \
     -d '{ "email": "no-es-email", "name": "" }'
   ```
   Lee la respuesta. ¿Qué te dice el `treeifyError`?

3. **Crea un schema y exporta solo el tipo**:
   ```ts
   // src/types/user.ts
   import { z } from 'zod';
   export const UserSchema = z.object({ /* ... */ });
   export type User = z.infer<typeof UserSchema>;
   ```
   Importa `User` desde otro archivo con `import type { User } from './types/user.ts'`. ¿Qué pasa si quitas el `type`? (Pista: `verbatimModuleSyntax`).

4. **Reto**: en `src/env.ts`, añade un campo opcional `DATABASE_URL` que sea un `z.string().url()`. Pruébalo con y sin la variable en `.env`. Cuando esté ausente, ¿qué tipo tiene `env.DATABASE_URL`?

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 30 — *Be Liberal in What You Accept and Strict in What You Produce*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/loose-accept-strict-produce.md)** — el principio de Postel aplicado a TS. La justificación de `safeParse` aceptando `unknown` y devolviendo un tipo preciso.
- **[Item 46 — *Use `unknown` Instead of `any` for Values with an Unknown Type*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-any/never-unknown.md)** — `c.req.json()` devuelve `unknown`, no `any`. Por eso pasarlo por `safeParse` es obligatorio antes de tocarlo.
- **[Item 74 — *Know How to Reconstruct Types at Runtime*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/runtime-types.md)** — el corazón conceptual de Zod: schemas que producen tipos Y validadores a la vez.
- **[Item 76 — *Create an Accurate Model of Your Environment*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/model-env.md)** — exactamente el patrón de `src/env.ts`: validar `process.env` al arrancar y exportar el resultado tipado.

---

**Anterior:** [02 — tsconfig estricto](./02-tsconfig-strict.md)
**Siguiente:** [04 — Result type](./04-result-type.md)
