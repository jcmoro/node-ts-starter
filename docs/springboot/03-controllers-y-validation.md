# 03 — Controllers y Bean Validation

## El problema

Una API HTTP tiene cuatro responsabilidades básicas: aceptar requests en URLs concretas, parsear los datos que llegan, validarlos antes de hacer nada con ellos, y serializar la respuesta. Hacerlo a mano con `HttpServlet` es viable pero ruidoso — Spring MVC lo reduce a anotaciones declarativas:

- **Routing** — `@GetMapping("/users/{id}")` define a la vez el método HTTP y la plantilla de URL.
- **Binding del input** — `@PathVariable`, `@RequestParam`, `@RequestBody` extraen partes del request y las tipan.
- **Validación** — `@Valid` activa las constraints de `jakarta.validation` sobre el body o los parámetros.
- **Serialización** — Spring + Jackson convierten el objeto que devuelves en JSON automáticamente.

Y todo esto se conecta al IoC container del cap. 02: tu `@RestController` es un bean, recibe sus dependencias por constructor, y Spring lo registra en el dispatcher servlet al arrancar.

## `@RestController` y mapping de rutas

Mira `services/spring-api/src/main/java/com/josemoro/api/users/UserController.java`:

```java
@RestController
@RequestMapping("/users")
public class UserController {

    private final UserService service;

    public UserController(UserService service) {
        this.service = service;
    }

    @GetMapping
    public List<User> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public ResponseEntity<User> getById(@PathVariable String id) {
        return service.findById(id)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<User> create(@Valid @RequestBody CreateUserRequest request) {
        var user = service.create(request);
        return ResponseEntity.created(URI.create("/users/" + user.getId())).body(user);
    }
}
```

Tres anotaciones que conviene desglosar.

### `@RestController` = `@Controller` + `@ResponseBody`

```java
@Controller        // "esta clase responde a HTTP"
@ResponseBody      // "lo que devuelvas, serialízalo al body (JSON), no busques una vista"
```

`@RestController` es la combinación. Si pones `@Controller` solo, Spring asume que el return value es un **nombre de vista** (Thymeleaf, JSP) — útil en apps server-rendered, no en una API REST.

> 💡 **Convención**: en APIs REST, **siempre** `@RestController`. Reserva `@Controller` para apps con templates.

### `@RequestMapping("/users")` a nivel clase

Define el **prefijo** común para todos los métodos de la clase. Cada `@GetMapping`, `@PostMapping`, etc. añade su path encima:

```
@RequestMapping("/users")       →  prefijo
  @GetMapping                   →  GET /users
  @GetMapping("/{id}")          →  GET /users/{id}
  @PostMapping                  →  POST /users
```

Si solo necesitas un endpoint, puedes omitir `@RequestMapping` y poner el path completo en el `@GetMapping`:

```java
@RestController
public class HealthController {
    @GetMapping("/health")
    public Map<String, String> health() { ... }
}
```

Es exactamente lo que hace `HealthController.java` del repo.

### `@GetMapping`, `@PostMapping`, etc.

Atajos para `@RequestMapping(method = GET, path = "...")`. Existen para los seis métodos HTTP relevantes:

```java
@GetMapping     // listar, leer
@PostMapping    // crear
@PutMapping     // reemplazar el recurso completo
@PatchMapping   // actualizar parcialmente
@DeleteMapping  // borrar
@RequestMapping // genérico (cuando necesitas algo raro)
```

Usar `@RequestMapping(method = GET, path = "/foo")` directamente sigue funcionando, pero los atajos son **idiomáticos desde Spring 4.3**.

## Cómo recibir datos del request

Spring tiene cuatro anotaciones principales para extraer partes del HTTP request y bindearlas a parámetros del método.

### `@PathVariable` — parte de la URL

```java
@GetMapping("/{id}")
public ResponseEntity<User> getById(@PathVariable String id) { ... }
```

Lo que va entre `{}` en el path va al parámetro. Spring lo convierte al tipo declarado:

```java
@GetMapping("/{id}/orders/{orderId}")
public List<Order> listOrders(
    @PathVariable String id,
    @PathVariable("orderId") UUID order   // alias cuando el nombre no coincide
) { ... }
```

Si el conversor falla (ej. esperabas `UUID` y llega `"abc"`), Spring devuelve **400 Bad Request** automáticamente.

### `@RequestParam` — query string

```java
@GetMapping
public List<User> list(
    @RequestParam(defaultValue = "0") int page,
    @RequestParam(defaultValue = "20") int size,
    @RequestParam(required = false) String emailContains
) { ... }
```

`/users?page=0&size=20&emailContains=foo` → params bindeados. Atributos útiles:

- `defaultValue` — usado si el param no está.
- `required = false` — opcional (null si ausente).
- `name = "..."` — alias cuando el nombre Java no coincide con el HTTP.

### `@RequestBody` — cuerpo del request

```java
@PostMapping
public ResponseEntity<User> create(@RequestBody CreateUserRequest request) { ... }
```

Spring deserializa el body (JSON por defecto) al tipo declarado usando Jackson. Si el JSON no encaja con el shape del record/clase, Spring devuelve **400 Bad Request**.

`CreateUserRequest` es un **record** — sintaxis moderna y limpia para DTOs inmutables:

```java
public record CreateUserRequest(String email, String name) {}
```

Jackson lo detecta sin configuración extra. Los records son **idiomáticos en Spring 3.x para DTOs**.

### `@RequestHeader` — headers HTTP

```java
@PostMapping
public ResponseEntity<User> create(
    @RequestBody CreateUserRequest request,
    @RequestHeader("X-Tenant-Id") String tenantId,
    @RequestHeader(name = "X-Request-Id", required = false) String requestId
) { ... }
```

Mismo patrón que `@RequestParam`.

## Validación con `jakarta.validation` y `@Valid`

`CreateUserRequest` del repo lleva constraints:

```java
public record CreateUserRequest(
    @Email @NotBlank String email,
    @NotBlank String name
) {}
```

Y el controller activa la validación con `@Valid`:

```java
public ResponseEntity<User> create(@Valid @RequestBody CreateUserRequest request)
```

Cuando una constraint falla, Spring lanza `MethodArgumentNotValidException`, que el error handler default convierte en **400 Bad Request** con un body `ProblemDetail` (RFC 9457) describiendo qué campo falló.

### Constraints estándar de `jakarta.validation`

| Constraint           | Aplica a                | Significado                                             |
|----------------------|-------------------------|---------------------------------------------------------|
| `@NotNull`           | cualquier tipo          | No null                                                 |
| `@NotEmpty`          | String, Collection, Map | No null Y no vacío                                      |
| `@NotBlank`          | String                  | No null Y al menos 1 carácter no-whitespace             |
| `@Email`             | String                  | Formato email (RFC 5322 reducido)                       |
| `@Size(min=, max=)`  | String, Collection      | Longitud entre min y max                                |
| `@Min(n)` / `@Max(n)`| números                 | Valor mínimo/máximo (inclusive)                         |
| `@Positive` / `@PositiveOrZero` | números        | Mayor que 0 / mayor o igual a 0                         |
| `@Pattern(regexp=)`  | String                  | Cumple la regex                                         |
| `@Past` / `@Future`  | dates                   | En el pasado / futuro                                   |

Vienen del starter `spring-boot-starter-validation` que ya tenemos en el `pom.xml`.

### Validación anidada — `@Valid` en propiedades

```java
public record UpdateUserRequest(
    @Email @NotBlank String email,
    @Valid Address shippingAddress   // ← validar el address también
) {}

public record Address(
    @NotBlank String street,
    @NotBlank String city,
    @Size(min = 2, max = 2) String country
) {}
```

Sin el `@Valid` interno, Spring valida solo el nivel exterior y `Address` pasa aunque tenga campos vacíos.

### Validación de query/path params — `@Validated` a nivel clase

`@Valid` funciona dentro de `@RequestBody`. Para validar `@RequestParam` o `@PathVariable` directamente, **el controller necesita `@Validated`**:

```java
@RestController
@RequestMapping("/users")
@Validated   // habilita constraints en method-level params
public class UserController {

    @GetMapping("/by-email/{email}")
    public User byEmail(@PathVariable @Email String email) { ... }

    @GetMapping
    public List<User> list(
        @RequestParam @Min(0) int page,
        @RequestParam @Min(1) @Max(100) int size
    ) { ... }
}
```

Cuando falla, lanza `ConstraintViolationException` (distinto a `MethodArgumentNotValidException`). El error handler default también lo convierte a 400.

### Custom constraint — quick recipe

Si las built-in no cubren tu caso, declaras la tuya:

```java
@Documented
@Constraint(validatedBy = UsernameValidator.class)
@Target({ FIELD, PARAMETER })
@Retention(RUNTIME)
public @interface ValidUsername {
    String message() default "Username must be 3-20 lowercase alphanumeric chars";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class UsernameValidator implements ConstraintValidator<ValidUsername, String> {
    private static final Pattern PATTERN = Pattern.compile("^[a-z0-9]{3,20}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext ctx) {
        return value != null && PATTERN.matcher(value).matches();
    }
}
```

Uso:

```java
public record CreateUserRequest(
    @Email @NotBlank String email,
    @ValidUsername String username
) {}
```

## Cómo devolver respuestas

Dos estilos: **retorno directo** (Spring infiere status + headers) o **`ResponseEntity<T>`** (control fino).

### Retorno directo

```java
@GetMapping
public List<User> list() {
    return service.list();
}
```

Spring serializa la lista a JSON, status 200, content-type `application/json`. Si la lista está vacía, retorna `[]` con 200. Si el método tira excepción, status 500 (o lo que el error handler decida).

### `ResponseEntity<T>` — control fino

```java
@PostMapping
public ResponseEntity<User> create(@Valid @RequestBody CreateUserRequest request) {
    var user = service.create(request);
    return ResponseEntity
        .created(URI.create("/users/" + user.getId()))   // 201 + Location header
        .body(user);
}
```

`ResponseEntity` permite:
- Status custom (`ok()`, `created()`, `noContent()`, `notFound()`, `badRequest()`, `status(418)`, etc.).
- Headers custom (`.header("X-Custom", "value")` o `.location(uri)`).
- Body opcional (`.build()` para responses sin body — 204, 404).

### Patrón `Optional<T>` para "no encontrado"

```java
@GetMapping("/{id}")
public ResponseEntity<User> getById(@PathVariable String id) {
    return service.findById(id)
        .map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.notFound().build());
}
```

Si `findById` devuelve `Optional.of(user)` → 200 con el user. Si devuelve `Optional.empty()` → 404 sin body. Es **el patrón idiomático** para "leer por ID".

### `@ResponseStatus` — status declarativo

Para responses simples sin necesidad de `ResponseEntity`:

```java
@PostMapping
@ResponseStatus(HttpStatus.CREATED)
public User create(@Valid @RequestBody CreateUserRequest request) {
    return service.create(request);   // status 201 automático
}
```

Trade-off: declarativo y limpio, pero no puedes setear el header `Location` (que es lo que justifica el 201 según la spec REST). Para POST que crea recurso, **prefiere `ResponseEntity.created(...)`**.

## Status codes que Spring devuelve solo

Spring Boot 3.x configura un `ResponseEntityExceptionHandler` por defecto que mapea:

| Situación                                                  | Status |
|-----------------------------------------------------------|--------|
| `@Valid` falla                                             | 400    |
| `@RequestBody` con JSON inválido                           | 400    |
| `@PathVariable` no convertible al tipo declarado           | 400    |
| Falta un `@RequestParam` `required = true`                 | 400    |
| Método HTTP no soportado en la ruta                        | 405    |
| Accept header no satisfacible                              | 406    |
| Content-Type no aceptado (POST sin JSON)                   | 415    |
| Excepción no manejada                                      | 500    |

Y el body es un **`ProblemDetail`** (formato RFC 9457). Ejemplo de respuesta cuando `@Email` falla:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid request content.",
  "instance": "/users"
}
```

Lo veremos en detalle en el doc 07 (`@ControllerAdvice` y custom error handling).

## Content negotiation

Spring elige el formato de respuesta según el header `Accept` del cliente. JSON por defecto (Jackson). Para limitar explícitamente:

```java
@PostMapping(
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<User> create(@Valid @RequestBody CreateUserRequest request) { ... }
```

- `consumes` — qué Content-Types acepta el endpoint (filtra al entrar).
- `produces` — qué Content-Types puede devolver (filtra al salir).

Sin ellos, Spring acepta cualquier cosa que Jackson sepa leer/escribir.

## Trampas comunes

1. **Devolver la entity JPA directamente**:
   ```java
   @GetMapping("/{id}")
   public User getById(@PathVariable String id) { return repository.findById(id).get(); }
   ```
   Filtras campos internos (`@OneToMany` lazy collections, `password`, `createdAt` de auditoría) y abres ataques de mass-assignment si reutilizas la entity en el POST. **Define DTOs explícitos** (records) para input y output.

2. **`@Valid` no funciona sin starter**: si quitas `spring-boot-starter-validation` del `pom.xml`, las anotaciones **no fallan al compilar** — simplemente se ignoran. Síntoma: cualquier input pasa la "validación". Verifica con un test que un body inválido devuelve 400.

3. **`@PathVariable` sin nombre cuando difiere del param**:
   ```java
   @GetMapping("/{userId}")
   public User get(@PathVariable String id) { ... }   // ❌ "id" no encaja con "userId"
   ```
   Síntoma: `MissingPathVariableException`. Fix: `@PathVariable("userId") String id`.

4. **`@RequestParam` vs `@PathVariable` confundidos**:
   - URL `/users/123` → `@PathVariable`.
   - URL `/users?id=123` → `@RequestParam`.
   Si pones el equivocado, Spring devuelve 400 o 404 según el caso.

5. **`@Validated` ausente para validar params individuales**: las constraints en `@RequestParam` o `@PathVariable` se ignoran silenciosamente si el controller (o la clase) no lleva `@Validated`. Es una de las trampas más frustrantes de descubrir — el código se ve bien, los tests pasan porque el path no se cruza.

6. **`Optional` como tipo de parámetro o response body**:
   ```java
   public Optional<User> getById(...)   // ❌ Spring serializa { "present": true, "value": {...} }
   ```
   `Optional` está pensado para tipos de retorno **internos**, no para la API HTTP. Conviértelo a `ResponseEntity` o desempaquétalo antes de devolver.

7. **`@RequestBody` con record sin constructor canónico custom**: si el record tiene campos opcionales (con default), Jackson los pone a `null` (no usa el default del record). Para defaults reales en input, valida con `@NotNull` o usa un constructor compacto que aplique el fallback.

8. **`@ResponseStatus` ignorado cuando hay `ResponseEntity`**: si el método devuelve `ResponseEntity`, la anotación a nivel método se ignora — el status del `ResponseEntity` gana. Confunde si los mezclas.

## Ejercicio

1. **`GET /users` con paginación**: añade `@RequestParam(defaultValue = "0") int page` y `@RequestParam(defaultValue = "20") @Min(1) @Max(100) int size`. Marca el controller con `@Validated`. Modifica el service para usar `findAll(Pageable.of(page, size))` (Spring Data soporta `Pageable` nativo). Prueba con `curl 'http://localhost:8080/users?page=0&size=5'`.

2. **`GET /users/by-email/{email}`**: nuevo endpoint que devuelve el user por email. Valida que el path `email` tenga formato email con `@PathVariable @Email String email`. Confirma que `curl http://localhost:8080/users/by-email/foo` devuelve 400.

3. **Validación anidada**: añade un record `Address(street, city, country)` con constraints (`@NotBlank` para street/city, `@Size(min=2,max=2)` para country). Cambia `CreateUserRequest` para incluir un `@Valid Address shipping`. Confirma que el POST falla con 400 si `country` tiene 3 letras.

4. **Custom constraint `@ValidUsername`**: implementa la anotación y validator del ejemplo. Añade un campo `username` a `CreateUserRequest`. Prueba con un username válido (`josemoro`) y uno inválido (`Jose Moro!`).

5. **`ResponseEntity.created` vs `@ResponseStatus`**: compara la diferencia. Inspecciona los headers con `curl -i -X POST ...` y nota cómo `created(URI)` añade `Location: /users/...` que `@ResponseStatus(CREATED)` no.

6. **Reto — content negotiation**: añade un endpoint `GET /users/{id}.xml` o usa el header `Accept: application/xml`. Spring por defecto no soporta XML — añade `jackson-dataformat-xml` al pom.xml. ¿Qué cambia en la respuesta del MISMO controller?

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014)

- **Capítulo 5 — *Building Spring web applications***: lee la sección "Writing a basic controller" — `@Controller`, `@RequestMapping`, path variables siguen vigentes. **Salta** la parte de view resolvers, JSP, Tiles.
- **Capítulo 7 — *Advanced Spring MVC***: parte del request/response binding sigue válido, pero las versiones de las APIs (`javax.servlet`) ya no aplican — todo es `jakarta.servlet` en Spring 6.

> ⚠️ El libro usa **Bean Validation 1.1** (`javax.validation.constraints`). Spring 6 / Boot 3 usa **Jakarta Validation 3.0** (`jakarta.validation.constraints`). Los nombres de las anotaciones son los mismos, solo cambia el package.

### Documentación oficial

- [Spring Framework Reference — Spring Web MVC](https://docs.spring.io/spring-framework/reference/web/webmvc.html) — referencia completa, busca "Annotated Controllers".
- [Spring Framework Reference — Validation](https://docs.spring.io/spring-framework/reference/core/validation.html) — `@Valid` + Bean Validation + métodos validados.
- [RFC 9457 — Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457) — el formato que Spring usa para sus errores por defecto. 10 minutos.
- [Baeldung — Bean Validation Basics](https://www.baeldung.com/javax-validation) — listado completo de constraints con ejemplos.

---

**Anterior:** [02 — DI y beans: IoC container, autowiring, scopes](./02-di-y-beans.md)
**Siguiente:** [04 — Spring Data JPA: entidades, repos, transacciones](./04-spring-data-jpa.md)
