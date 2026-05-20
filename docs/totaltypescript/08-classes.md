# 08 — Classes

> 📖 Capítulo original: [Classes](https://www.totaltypescript.com/books/total-typescript-essentials/classes)

## Qué cubre Matt — HUECO REAL

Nuestro track principal evita classes deliberadamente (preferimos records + functional patterns). Este capítulo cubre el modelo OO de TS:

1. **Crear una clase**: constructor, propiedades, métodos, uso como tipo.
2. **Modifiers de visibilidad**: `public` (default), `private` (compile-time), `#` prefix (runtime privacy), `protected`.
3. **`readonly`**, `?` optional, parameter properties (shortcut del constructor).
4. **Herencia**: `extends`, `protected`, `override` (TS 4.3+), `implements`, `abstract` classes y methods.

## Lo que importa

### Parameter properties — el atajo TS

La sintaxis más distintiva de TS sobre clases JS estándar:

```ts
// JS estándar / TS verbose
class User {
  private readonly id: string;
  private readonly email: string;

  constructor(id: string, email: string) {
    this.id = id;
    this.email = email;
  }
}

// TS parameter properties — declaración Y asignación en el ctor
class User {
  constructor(
    private readonly id: string,
    private readonly email: string,
  ) {}
}
```

Las dos formas producen **exactamente el mismo JS**. Las parameter properties son azúcar puro pero ahorran mucho ruido. Es lo idiomático en proyectos modernos.

### `private` (TS) vs `#` (ECMAScript)

```ts
class Foo {
  private secret = 42;    // TS private: compile-time only
  #realSecret = 42;        // ECMAScript private: runtime enforcement
}

const f = new Foo();
(f as any).secret;           // ✅ funciona en runtime (TS ya no protege)
(f as any).realSecret;       // undefined — no es accesible ni con as any
```

**Diferencia crítica**: `private` de TS desaparece al transpilar — es solo info para el type checker. `#` (hash) es estándar ECMAScript 2022+ y produce un **WeakMap interno** que hace el field inaccessible incluso desde reflection.

Matt's recomendación moderna:
- **Usa `#` si la privacidad de runtime importa** (librerías públicas, datos sensibles).
- **`private` está bien para la mayoría** de código de aplicación donde solo te interesa que tus colegas no toquen.

### `override` keyword (TS 4.3+)

```ts
class Animal {
  speak(): string { return 'sound'; }
}

class Dog extends Animal {
  override speak(): string { return 'bark'; }   // explícito
}

class Cat extends Animal {
  override speeak(): string { return 'meow'; }  // ❌ typo → TS protesta porque
                                                 //   "speeak" no existe en Animal
}
```

Activa con `"noImplicitOverride": true` en tsconfig — entonces `override` se vuelve obligatorio. Previene un bug clásico de OO: typear el nombre de un método override y crear silenciosamente un método nuevo en lugar de overriding.

### `implements` vs `extends`

```ts
interface Logger {
  log(msg: string): void;
}

// extends: hereda implementación + estructura
class FileLogger extends BaseLogger { ... }

// implements: solo contrato estructural, sin herencia de impl
class FileLogger implements Logger {
  log(msg: string): void {
    fs.appendFileSync('log.txt', msg);
  }
}
```

`implements` es "cumple este contrato pero no me heredes nada". Útil para forzar que una clase cumpla varias interfaces (Java equivalent: `implements`). En TS estructural, `implements` es **redundante en muchos casos** — si tu clase tiene un `log(msg: string): void`, ya es asignable a `Logger`. Pero `implements` hace **explícito** el contrato y los errores se reportan **en la clase**, no en el sitio de uso.

### Abstract classes

```ts
abstract class Repository<T> {
  abstract findById(id: string): Promise<T | null>;
  abstract save(entity: T): Promise<T>;

  // Implementación parcial compartida
  async findByIdOrThrow(id: string): Promise<T> {
    const result = await this.findById(id);
    if (!result) throw new Error(`Not found: ${id}`);
    return result;
  }
}

class UserRepository extends Repository<User> {
  async findById(id: string): Promise<User | null> { ... }
  async save(user: User): Promise<User> { ... }
  // findByIdOrThrow se hereda gratis
}
```

`abstract` clases no se pueden instanciar (`new Repository()` ❌). `abstract` métodos no tienen body; las subclases deben implementarlos. Útil para "framework base" patterns.

## Cómo se compara con nuestro track

Nuestro track TS evitó classes. Las pocas que aparecen son:

- En `services/spring-api/.../User.java` — JPA exige class con no-arg constructor.
- En `web/` (si hay) — DOM elements wrappers.

**Razones por las que nuestro track funcional preferido**:

1. **Records son inmutables por construcción** — no necesitas `readonly` en cada propiedad.
2. **Discriminated unions modelan estados mejor que herencia OO**.
3. **Functions higher-order** > polymorphism para muchos casos.
4. **Tree-shaking**: classes no se tree-shakean fácilmente; functions sí.

**Cuándo classes ganan**:
- Estado mutable encapsulado (UI state, connection pools, builders).
- Framework integration que exige classes (NestJS, Angular, JPA en Spring).
- Polymorphism dinámico real (la decisión de qué método llamar es runtime).

## Ideas que merecen anotarse

### "TS classes son JS classes con sintaxis extra"

Modifiers, abstract, implements **desaparecen al transpilar**. El JS resultante es ECMAScript estándar. Esto significa:

- `private`/`protected` son útiles solo en código TS interno.
- Los hash-private (`#field`) son los únicos que sobreviven en runtime.
- Los decorators (cap. 9) sí tienen impacto runtime.

### Class vs function: el debate eterno

Matt no toma una posición fuerte. La nuestra (heredada de Effective TS y la comunidad funcional):

> **Default a functions + records. Sube a class solo cuando el problema lo justifique** (estado mutable, framework integration, polymorphism real).

Esto no es universal. En NestJS, Angular, o cualquier framework class-based, la decisión está hecha por ti. En libs utility, lambdas + closures son superiores.

### `readonly` + `private` casi siempre van juntas

```ts
class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly clock: Clock,
  ) {}
}
```

Si el dep es inyectado y no debería cambiar, **siempre** `readonly`. Es lo que ves en `services/spring-api/.../UserService.java` (Spring constructor injection con `private final`).

## Ejercicio

1. **Refactor de un record a class**: toma el record `User` de `services/node-api/src/domain/user.ts` y conviértelo a una class con parameter properties + getters. Compara los dos enfoques: ¿cuál te resulta más natural? ¿Cuál sería mejor para tu próximo proyecto?

2. **`implements` para forzar contratos**: define `interface UserRepositoryContract` con los métodos públicos. Hace que `UserService` reciba `UserRepositoryContract` en lugar del impl concreto. ¿Qué refactor sale más fácil después?

3. **`abstract` clase base**: implementa `abstract class Repository<T>` con `findByIdOrThrow` heredado y `findById`/`save` abstractos. Crea `UserRepositoryImpl extends Repository<User>`. ¿Cómo se compara con extender `JpaRepository<T, ID>` en `services/spring-api/`?

4. **`#` private vs `private`**: crea una clase con un secret. Intenta leerlo con `(obj as any).secret` con `private` (sí funciona) y `#secret` (no funciona). ¿Cuándo querrías cada uno?

5. **`override` keyword**: añade `"noImplicitOverride": true` a `tsconfig.json` (en un fork del repo). Verifica que las subclases sin `override` rompen. Es protección frente al typo silent override.

6. **Reto — `decorator` simple sobre method**: el cap. 9 entra a fondo, pero adelántate: escribe un `@log` decorator que loguee entradas y salidas de un método. Necesitarás `"experimentalDecorators": true` o el nuevo standard TC39.

## 📖 Otros recursos

- [TypeScript Handbook — Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) — referencia oficial.
- [ECMAScript Private Class Fields](https://github.com/tc39/proposal-class-fields) — el spec del `#` prefix.
- [Effective TypeScript — Item 6 / Item 7](https://github.com/danvk/effective-typescript) — sobre cuándo usar classes vs functions/interfaces.

---

**Anterior:** [07 — Mutability](./07-mutability.md)
**Siguiente:** [09 — TypeScript-only Features](./09-typescript-only-features.md)
