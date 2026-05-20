# 05 — Records y sealed classes para el dominio

## El problema

Java pre-14 era doloroso para modelar **value objects** — esas clases pequeñas que solo agrupan datos (`Email`, `Money`, `Address`, `Coordinates`). Mira lo que tenías que escribir para un par `(x, y)`:

```java
public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int getX() { return x; }
    public int getY() { return y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }

    @Override
    public int hashCode() {
        return Objects.hash(x, y);
    }

    @Override
    public String toString() {
        return "Point{x=" + x + ", y=" + y + "}";
    }
}
```

40 líneas para "un punto tiene un x y un y". Lombok mitigaba esto con `@Value` pero introducía una dependencia, generaba código vía processor, y daba problemas con debuggers y herramientas.

Java 16 introdujo **records**. Y la ergonomía cambió:

```java
public record Point(int x, int y) {}
```

Una línea. Inmutable, con `equals`/`hashCode`/`toString` correctos, accesores generados (`p.x()`, `p.y()`). Es el feature más importante para devs Java acostumbrados a clases verbosas — modelar el dominio se vuelve barato.

Y Java 17 añadió **sealed classes/interfaces**, la pieza que faltaba para tener **discriminated unions** robustas en Java. Combinadas con **pattern matching for switch** (Java 21), permiten modelar resultados, eventos y comandos de forma exhaustiva y type-safe.

Este doc cubre los tres juntos: records, sealed, pattern matching. Es el toolkit moderno para modelar dominio en Spring Boot 3.x.

## Records: lo básico

```java
public record User(String id, String email, String name) {}
```

Lo que el compilador genera por ti:

1. **Constructor canónico**: `new User(id, email, name)`.
2. **Accesores**: `user.id()`, `user.email()`, `user.name()` (sin `get` prefijo).
3. **`equals(Object)`**: estructural — dos `User` son iguales si todos sus campos lo son.
4. **`hashCode()`**: derivado de todos los campos.
5. **`toString()`**: `User[id=..., email=..., name=...]`.
6. **Immutabilidad**: campos `private final`, sin setters posibles.

Si quieres añadir lógica (métodos, validación), puedes:

```java
public record User(String id, String email, String name) {

    // Compact constructor — valida sin reasignar campos manualmente.
    public User {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id must not be blank");
        }
        if (email == null || !email.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + email);
        }
    }

    // Métodos custom — derivados, puros, no estado.
    public String displayName() {
        return name + " <" + email + ">";
    }

    // Static factory cuando el constructor no es expresivo.
    public static User newWithGeneratedId(String email, String name) {
        return new User(UUID.randomUUID().toString(), email, name);
    }
}
```

### Compact constructor — validación al construir

El "compact constructor" (sin paréntesis) corre **antes** de la asignación a los campos. Útil para validar o **normalizar**:

```java
public record Email(String value) {
    public Email {
        Objects.requireNonNull(value, "email value");
        value = value.trim().toLowerCase();   // normaliza
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
    }
}
```

La reasignación `value = ...` es **local** — modifica la variable que Java luego asigna al campo `final`. No es una mutación del field.

Esto es el patrón **smart constructor**: si tienes un `Email`, garantía compile-time **y** runtime de que pasó la validación. Útil para domain modeling.

### Records y Jackson

Records funcionan con Jackson **sin configuración extra** desde Jackson 2.12. El `CreateUserRequest` que ya está en el repo es un record:

```java
public record CreateUserRequest(
    @Email @NotBlank String email,
    @NotBlank String name
) {}
```

Jackson llama al constructor canónico con los valores del JSON. Spring + Boot 3 lo soportan nativamente.

> 💡 **Cuándo Jackson pone null vs falla**: si el JSON no incluye un campo del record, Jackson lo deserializa a `null` (o a 0 / false para primitivos). El record no tiene noción de "default value" — para defaults reales, usa un compact constructor que aplique fallback:
> ```java
> public record Pagination(int page, int size) {
>     public Pagination {
>         if (size <= 0) size = 20;
>     }
> }
> ```

### Records y Bean Validation

Las anotaciones de `jakarta.validation` funcionan sobre los componentes del record, como viste en el doc 03:

```java
public record CreateUserRequest(
    @Email @NotBlank String email,
    @NotBlank @Size(min = 1, max = 100) String name
) {}
```

Spring intercepta cuando aplicas `@Valid` y ejecuta las constraints **antes** del compact constructor.

### Limitaciones de los records

| Quiero...                                | ¿Records lo permiten?     |
|------------------------------------------|---------------------------|
| Heredar de una clase concreta            | ❌ Implícito `extends Record` |
| Implementar interfaces                   | ✅                         |
| Tener campos `static`                    | ✅                         |
| Tener métodos `static`                   | ✅                         |
| Sobreescribir el constructor canónico    | ✅ (con cuidado)           |
| Mutar campos                             | ❌ Inmutable por definición |
| Ser una `@Entity` JPA                    | ❌ (JPA pide no-arg ctor) |
| Ser un Spring `@Component`               | ✅ (raro, pero válido)     |
| Generar Serializable                     | ✅ Implementa Serializable automáticamente si los campos lo son |

La restricción más importante en práctica: **un record no puede ser una entidad JPA** (lo viste en el cap. 04). Records son perfectos para **DTOs e input/output del API**; entities siguen siendo `class` con no-arg constructor protegido.

## Sealed classes y interfaces

Una `sealed interface` o `sealed class` declara explícitamente **quién puede extenderla**. Cierra la jerarquía:

```java
public sealed interface PaymentMethod
    permits CreditCard, BankTransfer, Cash {}

public record CreditCard(String number, YearMonth expires) implements PaymentMethod {}
public record BankTransfer(String iban) implements PaymentMethod {}
public record Cash() implements PaymentMethod {}
```

Tres efectos:

1. **Nadie más** puede `implements PaymentMethod` fuera de los `permits`.
2. El compilador **sabe** que las únicas opciones son esas tres → exhaustiveness checks.
3. La jerarquía se vuelve **datos**, no extensibilidad polimórfica.

### `final`, `sealed`, `non-sealed` — la regla

Cada subclase de un sealed type debe declarar **cómo se extiende a sí misma**:

- `final` (default para records) — no se puede extender más.
- `sealed permits ...` — vuelve a sellar.
- `non-sealed` — libre, cualquiera puede extenderla.

```java
public sealed interface Shape permits Circle, Rectangle, Polygon {}

public record Circle(double radius) implements Shape {}              // final implícito
public record Rectangle(double w, double h) implements Shape {}
public non-sealed class Polygon implements Shape { ... }              // abierto
```

`non-sealed` es la válvula de escape para librerías que sí quieren permitir extensión externa. En modelado de dominio típicamente **no la querrás**.

### Cuándo usar sealed

- **Resultados discriminados** (`Result<T, E>`, `OperationOutcome`, `LoginResult`).
- **Eventos** de event sourcing.
- **Comandos** en CQRS.
- **Estados** de una máquina de estados.
- **AST nodes** de un parser o DSL.

Si una jerarquía tiene **un número finito y conocido** de variantes y **el código que la consume necesita conocer todas**, sealed encaja. Si es polimorfismo extensible ("cada plugin añade su tipo"), interface tradicional.

## Pattern matching for switch (Java 21)

La combinación que cierra el círculo. Java 21 hace el `switch` consciente de tipos:

```java
public String describe(PaymentMethod method) {
    return switch (method) {
        case CreditCard c -> "Credit card ending in " + c.number().substring(c.number().length() - 4);
        case BankTransfer b -> "Bank transfer to " + b.iban();
        case Cash _ -> "Cash payment";
    };
}
```

Cuatro novedades respecto al `switch` antiguo:

1. **`case Type var ->`**: type pattern. Sin cast manual, `c` ya tiene tipo `CreditCard`.
2. **Switch como expresión** (`return switch (...)`): devuelve un valor; obliga a manejar todos los casos.
3. **Exhaustiveness**: si `PaymentMethod` es sealed con esos 3 permits, el compilador **no necesita** un `default`. Si añades una variante nueva sin actualizar el switch, **falla la compilación**.
4. **`_` (unnamed pattern)**: descarta variables que no usas (Java 21).

### Record patterns — destructuración

Java 21 también añadió destructuración de records:

```java
public String describe(PaymentMethod method) {
    return switch (method) {
        case CreditCard(var number, var expires) ->
            "Credit card " + number + " expires " + expires;
        case BankTransfer(var iban) ->
            "Bank transfer to " + iban;
        case Cash _ ->
            "Cash payment";
    };
}
```

Sin acceder a `c.number()` — el patrón lo extrae directamente. Anidable:

```java
record Address(String street, String city) {}
record Customer(String name, Address address) {}

String summary = switch (input) {
    case Customer(var name, Address(var street, var city)) ->
        name + " lives at " + street + ", " + city;
};
```

### Guarded patterns — condiciones extra

Cláusula `when` para refinar:

```java
return switch (transaction) {
    case Purchase p when p.amount() > 1000 -> "High value purchase";
    case Purchase p -> "Standard purchase";
    case Refund _ -> "Refund";
};
```

El orden importa: el primer caso que matchea gana. El segundo `case Purchase p` captura los Purchase que no son "high value".

## Aplicado al dominio

### Value objects con records

Refactorizar `CreateUserRequest` para usar tipos del dominio:

```java
public record Email(String value) {
    public Email {
        Objects.requireNonNull(value);
        value = value.trim().toLowerCase();
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
    }

    @Override
    public String toString() {
        return value;
    }
}

public record UserName(String value) {
    public UserName {
        Objects.requireNonNull(value);
        value = value.strip();
        if (value.isEmpty() || value.length() > 100) {
            throw new IllegalArgumentException("invalid name length");
        }
    }
}

public record CreateUserCommand(Email email, UserName name) {}
```

Beneficios:

- Cualquier método que reciba `Email` tiene **garantía** de que pasó la normalización (lowercased + trimmed).
- Tipo distinto a `String` — el compilador te protege de confundir `Email` con `UserId` o cualquier otra string.
- Validación en **un único sitio** — el compact constructor.

⚠️ **Trade-off**: Jackson + Bean Validation con records "envueltos" como `Email(String value)` requiere algo de configuración. Para el camino corto, puedes:
- Mantener el `CreateUserRequest` con `String email` + `@Email` validation (rápido).
- O usar `@JsonValue` y un `@JsonCreator` para que Jackson serialize/deserialize el record como su valor primitivo.

### Resultados discriminados con sealed

El service del repo lanza excepciones para errores de dominio. Una alternativa es modelar el resultado:

```java
public sealed interface CreateUserResult
    permits CreateUserResult.Created,
            CreateUserResult.DuplicateEmail,
            CreateUserResult.InvalidInput {

    record Created(User user) implements CreateUserResult {}
    record DuplicateEmail(String email) implements CreateUserResult {}
    record InvalidInput(List<String> errors) implements CreateUserResult {}
}
```

El service devuelve el sealed type:

```java
@Transactional
public CreateUserResult create(CreateUserCommand command) {
    if (repository.existsByEmail(command.email().value())) {
        return new CreateUserResult.DuplicateEmail(command.email().value());
    }
    var user = repository.save(new User(
        UUID.randomUUID().toString(),
        command.email().value(),
        command.name().value()
    ));
    return new CreateUserResult.Created(user);
}
```

Y el controller hace pattern matching para mapear cada variante al HTTP:

```java
@PostMapping
public ResponseEntity<?> create(@Valid @RequestBody CreateUserRequest request) {
    var command = new CreateUserCommand(new Email(request.email()), new UserName(request.name()));

    return switch (service.create(command)) {
        case CreateUserResult.Created(var user) ->
            ResponseEntity.created(URI.create("/users/" + user.getId())).body(user);
        case CreateUserResult.DuplicateEmail(var email) ->
            ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", "email_taken", "email", email));
        case CreateUserResult.InvalidInput(var errors) ->
            ResponseEntity.badRequest().body(Map.of("errors", errors));
    };
}
```

Si más adelante añades `case Suspended(User user, Instant since)` al sealed, el compilador **te obliga** a manejarlo aquí. Sin excepciones que se filtran sin que nadie las catee.

> 💡 **Excepciones vs sealed results**: las excepciones son para condiciones **excepcionales** (DB caída, bug, invariante violada). Los sealed results son para condiciones **esperadas del dominio** (email duplicado, recurso no encontrado, validación fallida). Mezclar bien las dos cosas es lo que distingue un dominio bien modelado.

### Eventos y comandos

```java
public sealed interface UserEvent {
    Instant occurredAt();

    record Created(String userId, Email email, Instant occurredAt) implements UserEvent {}
    record EmailChanged(String userId, Email oldEmail, Email newEmail, Instant occurredAt) implements UserEvent {}
    record Deactivated(String userId, String reason, Instant occurredAt) implements UserEvent {}
}
```

Un `EventHandler` queda exhaustivo:

```java
public void handle(UserEvent event) {
    switch (event) {
        case UserEvent.Created c -> notificationService.welcome(c.email());
        case UserEvent.EmailChanged ec -> auditService.logEmailChange(ec);
        case UserEvent.Deactivated d -> billingService.cancelSubscriptions(d.userId());
    }
}
```

Patrón clásico de event-driven, ahora **type-safe** sin frameworks externos.

## Trampas comunes

1. **`equals`/`hashCode` usan TODOS los campos del record**: si quieres comparar por id (entidad), records no son la herramienta — usa una `class` con `equals` custom. Records están pensados para value semantics.

2. **Defaults en parámetros — no existen**: los records no tienen "valor por defecto" en el constructor. Si el JSON no manda un campo, Jackson pone null (o 0 para primitivos). Para defaults reales, usa compact ctor o factory:
   ```java
   public record Pagination(int page, int size) {
       public static Pagination defaults() { return new Pagination(0, 20); }
   }
   ```

3. **Mezcla con `@Entity`**: ya cubierto en el cap. 04 — records no funcionan como JPA entities. Usa records para DTOs/comandos/eventos, classes para entities.

4. **Records "envueltos" en JSON**: si tienes `record Email(String value)`, por defecto Jackson lo serializa como `{"value": "x@y"}` (no como `"x@y"`). Si quieres el segundo formato, añade `@JsonValue` al componente:
   ```java
   public record Email(@JsonValue String value) { ... }
   ```
   Y un `@JsonCreator` o accept `String` en el constructor.

5. **`Optional` como componente de record**: técnicamente posible pero confuso. `record Foo(Optional<String> bar)` no tiene sentido — `Foo` es inmutable, el `Optional` es solo un wrapper que añade ruido. Para campos opcionales en records, marca con `@Nullable` y usa `null` directamente, o crea dos records distintos.

6. **Sealed sin pattern matching**: técnicamente correcto pero **pierde el beneficio principal**. Si vas a hacer `if (x instanceof Foo)` con `else if` para cada variante, ganas poco vs una interface normal. La razón de existir de sealed es habilitar exhaustiveness checks en switch.

7. **Sealed types entre módulos**: los `permits` deben estar en el **mismo package o módulo** que el sealed. Si quieres permitir variantes externas, usa `non-sealed` (perdiendo exhaustividad) o reconsidera el diseño.

8. **Pattern matching sin sealed**: el compilador exige `default` si el tipo no es sealed. Sin sealed:
   ```java
   switch (event) {
       case Click c -> ...;
       case Keypress k -> ...;
       default -> throw new IllegalStateException();   // requerido
   }
   ```
   Con sealed, el default sobra (y el compilador te grita si añades una variante sin actualizar el switch).

9. **Records con Lombok**: pueden mezclarse pero suele indicar que estás reutilizando malos hábitos. `@Builder` sobre un record es raro — los records ya tienen constructor canónico claro. Para builders, prefiere un factory static method en el record.

10. **`var` en record patterns vs explicit type**: `case CreditCard(var number, var expires)` infiere los tipos de los componentes. Si los renombras en el record, el código del switch sigue funcionando — solo cambia el nombre que tú usas internamente. **Más resistente a refactors** que `case CreditCard(String number, YearMonth expires)`.

## Ejercicio

1. **`Email` como record en el dominio**: crea `services/spring-api/src/main/java/com/josemoro/api/users/Email.java` como record con compact constructor que valide y normalice. Cambia `User.email` a `String` (sigue en DB como TEXT) pero el `UserService` convierte: `new Email(request.email()).value()`. Comprueba que un email con mayúsculas se guarda en lowercase.

2. **`UserName` también**: el mismo patrón. `@NotBlank`, `@Size(min=1, max=100)` en `CreateUserRequest` ahora **redundante** con la validación del record — decide cuál mantener (sugerencia: ambas; la del API rechaza con 400, la del dominio es defensiva).

3. **`CreateUserResult` sealed**: implementa el sealed result type del ejemplo. Refactoriza `UserService.create` para devolverlo. Refactoriza `UserController.create` con el switch. Confirma que añadir un nuevo `case Suspended(...)` al sealed **rompe la compilación** del controller hasta que lo manejes.

4. **Pattern matching con guards**: añade un endpoint `POST /users/from-csv` que reciba una lista de inputs. Implementa lógica que pase por validación y devuelva un sealed `BatchResult { AllOk(List<User>), PartiallyDone(List<User>, List<Failure>), AllFailed(List<Failure>) }`. El controller hace switch sobre el sealed.

5. **Record patterns para destructurar**: usa `case CreateUserResult.Created(User user)` en lugar de `case CreateUserResult.Created c -> c.user()`. ¿Cuándo prefieres uno y cuándo el otro? Pista: cuando vas a usar **uno solo** de los campos, el record pattern es más limpio.

6. **Reto — Event sourcing simple**: define `UserEvent` como sealed con `Created`, `EmailChanged`, `Deactivated`. Persiste cada evento en una tabla `user_events(id, user_id, type, payload_json, occurred_at)`. Reconstruye un `User` aplicando todos sus eventos en orden con pattern matching. Es el primer paso hacia event sourcing — sin frameworks, solo records + sealed + switch.

## 📖 Lectura paralela

> ⚠️ Esto **no está en el libro** (4ª ed., 2014). Records llegaron en Java 16 (2021), sealed en Java 17 (2021), pattern matching for switch en Java 21 (2023). Todo lo siguiente es post-libro.

### JEPs (los specs oficiales — concisos y autoritativos)

- [JEP 395 — Records (final, Java 16)](https://openjdk.org/jeps/395) — el record propiamente. Lee la motivación y la sintaxis.
- [JEP 409 — Sealed Classes (final, Java 17)](https://openjdk.org/jeps/409) — sealed, permits, non-sealed.
- [JEP 441 — Pattern Matching for switch (final, Java 21)](https://openjdk.org/jeps/441) — la versión final del switch con patrones.
- [JEP 440 — Record Patterns (final, Java 21)](https://openjdk.org/jeps/440) — destructuración de records.
- [JEP 443 — Unnamed Patterns and Variables (preview, Java 21)](https://openjdk.org/jeps/443) — el `_`.

### Artículos / libros

- [Inside Java — Pattern Matching for Java](https://inside.java/tag/pattern-matching) — los autores del feature explicando la evolución.
- [Inside Java — Data Oriented Programming in Java](https://inside.java/2024/05/23/dop-v1-1-introduction/) — la filosofía detrás de records + sealed + switch. Brian Goetz lo defiende como el "estilo idiomático" del Java moderno.
- [Brian Goetz — Towards Better Java Data Modeling](https://www.youtube.com/watch?v=8FRU_aGY4mY) — charla (50 min) sobre cuándo records, cuándo classes, cuándo sealed.

### Documentación oficial

- [Spring Framework Reference — Java Records](https://docs.spring.io/spring-framework/reference/core/beans/java/bean-annotation.html) — uso de records como `@ConfigurationProperties` (lo veremos en el cap. 08).

---

**Anterior:** [04 — Spring Data JPA: entidades, repos, transacciones](./04-spring-data-jpa.md)
**Siguiente:** [06 — Testing: `@SpringBootTest`, MockMvc, Testcontainers](./06-testing.md)
