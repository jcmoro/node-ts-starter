# @ts-starter/classes-demo

> Comparativa side-by-side: el mismo dominio modelado en **functional style** (records + factories, lo que usa `services/node-api/`) y en **OO style** (classes con parameter properties, private constructors, abstract base). Aplica los ejercicios 1, 2 y 3 del [doc 8 — Classes del track Total TypeScript](../../docs/totaltypescript/08-classes.md).

## Qué demuestra

Mismo caso de uso (User + Repository), dos paradigmas:

### Functional ([`src/user-functional.ts`](./src/user-functional.ts))

```ts
export type Email = string & { readonly [__email]: 'Email' };

export type User = {
  readonly id: UserId;
  readonly email: Email;
  readonly name: string;
};

export function makeEmail(raw: string): Email | null { ... }
export function newUser(input: { email: Email; name: string }): User { ... }
export function createInMemoryUserRepository(): UserRepository { ... }
```

- Branded types con `unique symbol`.
- Smart constructors como funciones libres.
- Repository como factory que cierra sobre estado (closure).
- Sin `class` keyword en todo el archivo.

### OO ([`src/user-oo.ts`](./src/user-oo.ts))

```ts
export class Email {
  private constructor(public readonly value: string) {}
  static fromRaw(raw: string): Email | null { ... }
}

export class User {
  constructor(
    public readonly id: UserId,
    public readonly email: Email,
    public readonly name: string,
  ) {}

  displayName(): string { return `${this.name} <${this.email.value}>` }
}

export abstract class UserRepository {
  abstract findById(id: UserId): Promise<User | null>;
  abstract save(user: User): Promise<User>;
  async findByIdOrThrow(id: UserId): Promise<User> { ... }   // shared
}

export class InMemoryUserRepository extends UserRepository { ... }
```

- Branded values como classes con private constructor + static factory.
- **Parameter properties** (declarar + asignar + scope en una línea).
- Abstract class con métodos abstract + helper compartido.
- `override` keyword para overrides explícitos (con `noImplicitOverride: true`).

## Trade-offs lado a lado

| Aspecto                          | Functional                                  | OO                                           |
|----------------------------------|---------------------------------------------|----------------------------------------------|
| Boilerplate por value object     | ~5 líneas (type + factory)                  | ~10 líneas (class + private ctor + factory) |
| Sobrecarga runtime               | Cero — objetos JSON-like                    | Objetos con prototype chain                  |
| Inspección en `console.log`      | Plain object con keys directas              | `User { ... }` con instancias anidadas       |
| Serialización JSON               | Trivial (`JSON.stringify` da el shape exacto) | Pierde el tipo (`{ value: "x" }` en lugar de `Email`) |
| Composición de comportamiento    | Función higher-order                         | Inheritance (`extends`) o composición        |
| Domain methods (`displayName`)   | Función separada `displayName(user)`         | Método natural `user.displayName()`           |
| Shared logic en repo             | `(repo: Repository) => ...` helpers          | Inheritance (`findByIdOrThrow` en abstract)  |
| Tree-shakeable                    | ✅ sí                                        | ⚠️ depende del bundler (classes son más difíciles) |
| Apto para JPA / ORM class-based  | ❌                                          | ✅ (TypeORM, MikroORM, Spring/Java)          |
| Apto para Spring-style frameworks | ❌                                          | ✅                                          |
| Curva de aprendizaje para devs OO | Media (cambio de paradigma)                 | Baja (familiar)                              |

## Por qué Node strip-types no basta

Node 22/23 `--experimental-strip-types` aún no soporta:

- **Parameter properties** (`public readonly id: UserId,` en el constructor).
- **TC39 stage 3 decorators** (cap. 9, ver `packages/decorators/`).

Por eso este package compila con `tsc` → ejecuta con `node`. Cuando strip-types añada soporte, bastará volver a `node --experimental-strip-types src/example.ts`.

## Cuándo elegir cada uno

**Functional** brilla en:
- Lambdas, scripts, edge runtimes (Cloudflare Workers, Deno Deploy).
- Pipelines de transformación (map/filter/reduce sobre datos planos).
- Frontends modernos (React functional components, Solid signals).
- APIs HTTP con immutability (lo que hace `services/node-api/`).

**OO** brilla en:
- Frameworks class-based (NestJS, Angular, TypeORM, JPA via Java).
- Estado mutable encapsulado con invariantes (builders, parsers, connection pools).
- Plugin systems con polymorphism dinámico.
- Equipos viniendo de Java/C#/C++ con preferencia OO establecida.

**El repo `services/node-api/`** eligió functional. **`services/spring-api/`** usa OO porque Spring lo exige. Ningún paradigma es universalmente mejor — depende del contexto.

## Run

```bash
npm install
npm start       # tsc + node dist/example.js
npm run typecheck
```
