# 07 — Error handling: `@ControllerAdvice` y `ProblemDetail`

## El problema

Una API HTTP debe convertir **todo** lo que sale mal en una respuesta HTTP coherente:

- Validación de input fallida.
- Recurso no encontrado.
- Regla de negocio violada (email duplicado, balance insuficiente).
- Fallo de infraestructura (DB caída, timeout).
- Bug imprevisto.

Cada categoría tiene su **status code apropiado**, su **shape de respuesta**, su **nivel de logging**, y reglas sobre **qué se puede filtrar al cliente** (jamás stack traces, IDs internos, mensajes con detalles de implementación).

Hacerlo a base de `try/catch` en cada controller es ruidoso y acopla la traducción a la lógica de negocio. Spring tiene tres mecanismos para centralizar el mapeo error → HTTP:

1. **`@ResponseStatus`** en la excepción (declarativo, simple).
2. **`@ExceptionHandler`** en el controller (local a esa clase).
3. **`@ControllerAdvice`** / **`@RestControllerAdvice`** (global a toda la app).

Más una pieza estándar: **`ProblemDetail` (RFC 9457)**, el formato JSON canónico para representar errores HTTP en APIs modernas.

Este doc cubre el patrón completo aplicado al `services/spring-api/`: definir excepciones de dominio, mapearlas con un advice global, y devolver responses tipadas y seguras.

## Lo que Spring ya hace por defecto

En Boot 3.x, sin que tú hagas nada, hay un `DefaultHandlerExceptionResolver` + `ResponseEntityExceptionHandler` que convierte estas excepciones automáticamente:

| Excepción                                  | Status | Cuándo se lanza                              |
|--------------------------------------------|--------|----------------------------------------------|
| `MethodArgumentNotValidException`          | 400    | `@Valid @RequestBody` falla                  |
| `ConstraintViolationException`             | 400    | `@Validated` en params individuales falla    |
| `HttpMessageNotReadableException`          | 400    | JSON malformado o no parseable               |
| `MissingServletRequestParameterException`  | 400    | Falta `@RequestParam required = true`        |
| `MethodArgumentTypeMismatchException`      | 400    | Path/query param no convertible al tipo      |
| `NoHandlerFoundException`                  | 404    | Ruta no existe                               |
| `HttpRequestMethodNotSupportedException`   | 405    | Método HTTP no soportado en la ruta          |
| `HttpMediaTypeNotAcceptableException`      | 406    | `Accept` header no satisfacible              |
| `HttpMediaTypeNotSupportedException`       | 415    | `Content-Type` no aceptado                   |
| Cualquier `Exception` no manejada          | 500    | Bug, NPE, infra error                        |

Y la respuesta sigue el formato **`ProblemDetail`** (RFC 9457):

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid request content.",
  "instance": "/users"
}
```

Ya lo viste en el cap. 03 cuando un POST con email inválido devuelve 400. **No necesitas escribir nada** para que estos errores se conviertan correctamente.

## Patrón 1 — `@ResponseStatus` sobre la excepción

El más simple. Anotas la excepción con el status que quieres:

```java
@ResponseStatus(HttpStatus.NOT_FOUND)
public class UserNotFoundException extends RuntimeException {
    public UserNotFoundException(String id) {
        super("user " + id + " not found");
    }
}
```

Y en el service:

```java
public User findByIdOrThrow(String id) {
    return repository.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id));
}
```

Cuando la excepción sube sin que nadie la capture, Spring lee la anotación y emite **404 Not Found**. La respuesta es un `ProblemDetail` con `status: 404`, `title: "Not Found"`, `detail: "user xxx not found"` (el `super(message)` rellena `detail`).

**Trade-off**: limitado. No puedes añadir properties custom al ProblemDetail, no puedes loguear con contexto, no puedes mapear N excepciones a una sola lógica de respuesta. Para casos simples (`UserNotFoundException` → 404), perfecto. Para casos con lógica, sube a advice.

## Patrón 2 — `@ExceptionHandler` local

Dentro del controller, declaras un método que maneja una excepción:

```java
@RestController
@RequestMapping("/users")
public class UserController {

    @PostMapping
    public ResponseEntity<User> create(@Valid @RequestBody CreateUserRequest req) {
        return ResponseEntity.created(...).body(service.create(req));
    }

    @ExceptionHandler(EmailAlreadyTakenException.class)
    public ProblemDetail handleEmailTaken(EmailAlreadyTakenException ex) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        problem.setProperty("email", ex.getEmail());
        problem.setProperty("code", "email_already_taken");
        return problem;
    }
}
```

Sólo aplica a las excepciones tiradas **dentro de este controller**. Útil cuando la lógica de mapeo es **inherentemente local** (raro). En la práctica, casi siempre quieres advice global.

## Patrón 3 — `@RestControllerAdvice` global

El patrón canónico. Una clase anotada que centraliza handlers para toda la app:

```java
package com.josemoro.api.errors;

import com.josemoro.api.users.EmailAlreadyTakenException;
import com.josemoro.api.users.UserNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;

import java.net.URI;
import java.util.List;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private static final URI ERRORS_BASE = URI.create("https://api.example.com/errors/");

    @ExceptionHandler(UserNotFoundException.class)
    public ProblemDetail userNotFound(UserNotFoundException ex) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setType(ERRORS_BASE.resolve("user-not-found"));
        problem.setTitle("User not found");
        problem.setProperty("userId", ex.getUserId());
        return problem;
    }

    @ExceptionHandler(EmailAlreadyTakenException.class)
    public ProblemDetail emailTaken(EmailAlreadyTakenException ex) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "Email is already registered");
        problem.setType(ERRORS_BASE.resolve("email-already-taken"));
        problem.setTitle("Email already taken");
        problem.setProperty("email", ex.getEmail());
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> validationFailed(MethodArgumentNotValidException ex) {
        var fieldErrors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> Map.of(
                "field", fe.getField(),
                "message", fe.getDefaultMessage() == null ? "invalid" : fe.getDefaultMessage()
            ))
            .toList();

        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        problem.setType(ERRORS_BASE.resolve("validation-failed"));
        problem.setTitle("Validation failed");
        problem.setProperty("errors", fieldErrors);
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> fallback(Exception ex, WebRequest request) {
        log.error("Unhandled exception", ex);   // log con stack trace
        var problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "An unexpected error occurred."   // sin detalles internos
        );
        problem.setType(ERRORS_BASE.resolve("internal"));
        problem.setTitle("Internal server error");
        return ResponseEntity.internalServerError().body(problem);
    }
}
```

### `@RestControllerAdvice` vs `@ControllerAdvice`

Igual que con controllers:
- **`@ControllerAdvice`** asume que devuelves nombre de vista. Para REST tienes que añadir `@ResponseBody` en cada method.
- **`@RestControllerAdvice`** = `@ControllerAdvice` + `@ResponseBody` aplicado a todos los handlers. **Es lo idiomático en APIs REST**.

### Resolución: orden y especificidad

Cuando una excepción se propaga, Spring busca el `@ExceptionHandler` **más específico** que coincida:

```java
@ExceptionHandler(SqlIntegrityException.class)        // más específico
public ProblemDetail constraintViolated(...) { ... }

@ExceptionHandler(DataAccessException.class)           // padre
public ProblemDetail dataIssue(...) { ... }

@ExceptionHandler(Exception.class)                     // fallback
public ProblemDetail anything(...) { ... }
```

Spring elige el primero (`SqlIntegrityException` extends `DataAccessException`). El fallback `Exception` solo se invoca si nada más matchea.

> 💡 **Orden de evaluación**: dentro de un advice, Spring usa el principio de "most specific". **No depende del orden en el código** — depende de la jerarquía de clases. Esto difiere de muchos otros frameworks (Express middleware, por ejemplo, va por orden de declaración).

### Limitar el scope del advice

Por defecto, `@RestControllerAdvice` aplica a **todos los controllers**. Para limitar:

```java
@RestControllerAdvice(basePackages = "com.josemoro.api.users")
public class UserApiExceptionHandler { ... }

@RestControllerAdvice(assignableTypes = {UserController.class, OrderController.class})
public class OrderUserAdvice { ... }

@RestControllerAdvice(annotations = LegacyApi.class)   // controllers anotados con @LegacyApi
public class LegacyApiAdvice { ... }
```

Útil si tienes APIs versionadas (`/v1/*` y `/v2/*`) con shapes de error distintos.

## `ProblemDetail` (RFC 9457) en detalle

El estándar moderno para representar errores HTTP en JSON. Spring 6 lo soporta nativamente.

Campos definidos por la RFC:

| Campo      | Tipo   | Descripción                                                       |
|------------|--------|-------------------------------------------------------------------|
| `type`     | URI    | Identificador del tipo de error (puede apuntar a tu doc)          |
| `title`    | String | Resumen corto, generalmente igual entre instancias del mismo tipo |
| `status`   | int    | Status HTTP (espejo del code de respuesta)                        |
| `detail`   | String | Explicación específica de **esta** ocurrencia                     |
| `instance` | URI    | URI específica del recurso/operación que falló                    |

Y puedes añadir **properties extra** (no estándar) con `.setProperty(name, value)`:

```java
var problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "Email taken");
problem.setProperty("code", "email_already_taken");        // tu código interno
problem.setProperty("email", taken);                       // contexto
problem.setProperty("suggestions", List.of("john2@..."));  // sugerencias
```

Resultado:

```json
{
  "type": "https://api.example.com/errors/email-already-taken",
  "title": "Email already taken",
  "status": 409,
  "detail": "Email is already registered",
  "instance": "/users",
  "code": "email_already_taken",
  "email": "jose@example.com",
  "suggestions": ["john2@example.com"]
}
```

> 💡 **Por qué `type` con URI**: la URI puede apuntar a una página de documentación que explique el error con detalle, soluciones, ejemplos. Es la diferencia entre "error code 0x42" (críptico) y "error_code_taken (https://docs.example.com/errors/email-already-taken)" (autoexplicativo).

### Content-Type de la respuesta

Spring serializa el `ProblemDetail` con content-type **`application/problem+json`** (no el genérico `application/json`). Clientes que parsean errores pueden detectarlo y aplicar tratamiento especial.

## Distinción: excepciones vs sealed results

Tienes dos formas de comunicar "algo salió mal":

1. **Lanzar una excepción** (`throw new EmailAlreadyTakenException(...)`).
2. **Devolver un sealed result** (`return new CreateUserResult.DuplicateEmail(email)`) — el patrón del cap. 05.

¿Cuándo cada una?

| Situación                                                | Mejor representación |
|----------------------------------------------------------|----------------------|
| Bug, NPE, invariante violado                             | Excepción            |
| Infra: DB caída, timeout, network                        | Excepción            |
| Email duplicado al crear user                            | Sealed result (debate) |
| User no encontrado al leer por id                        | Sealed result o `Optional` |
| Regla de negocio (balance insuficiente, plan expirado)   | Sealed result        |
| Validación de input                                      | Spring lo hace ya (excepción a 400) |

La línea: **excepción para lo "excepcional" (no debería pasar)**, **sealed result para lo "esperado del dominio" (puede pasar y el caller debe contemplarlo)**.

> 💡 **La práctica real**: muchos proyectos Spring usan **excepciones para todo** porque el `@RestControllerAdvice` es muy cómodo. Funciona. Pero pierdes la garantía compile-time de exhaustividad que el sealed result te da. Si tu lógica de errores es simple y centralizada, las excepciones son aceptables; si es compleja y crítica al dominio, sealed results son superiores.

En este repo, el patrón actual del `UserService` lanza excepciones; el doc 05 te muestra cómo refactorizar a sealed results si lo prefieres. Las dos están bien — sé consistente dentro de tu codebase.

## Logging dentro del advice

El advice es **el sitio natural** para loguear errores con contexto. Reglas prácticas:

```java
@ExceptionHandler(UserNotFoundException.class)
public ProblemDetail userNotFound(UserNotFoundException ex) {
    // 404 — esperado del dominio. NO log como ERROR. Quizá INFO o nada.
    return ...;
}

@ExceptionHandler(EmailAlreadyTakenException.class)
public ProblemDetail emailTaken(EmailAlreadyTakenException ex) {
    // 409 — esperado del dominio. INFO si quieres rastrear, no ERROR.
    log.info("Duplicate email registration attempt: {}", ex.getEmail());
    return ...;
}

@ExceptionHandler(Exception.class)
public ResponseEntity<ProblemDetail> fallback(Exception ex) {
    // 500 — bug. ERROR con stack trace.
    log.error("Unhandled exception", ex);
    return ...;
}
```

**No loguear 4xx como ERROR es importante**: un cliente con un bug enviando bodies inválidos puede generar miles de errores 400 por minuto. Si los logueas como ERROR, llenan las alertas y ocultan los problemas reales. Pauta general:

- **5xx** → log como `ERROR` con stack trace (algo en tu sistema falló).
- **4xx** → log como `INFO`/`WARN` (algo del cliente falló; sin stack trace, opcional).
- **2xx** → no loguear desde el advice (no son errores).

### Request ID en el log y el response

Si tienes un middleware que asigna un `requestId` a cada request (típico en APIs serias), inclúyelo en logs **y** en la respuesta:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<ProblemDetail> fallback(Exception ex, WebRequest request) {
    var requestId = request.getHeader("X-Request-Id");
    log.error("Unhandled exception (requestId={})", requestId, ex);

    var problem = ProblemDetail.forStatusAndDetail(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "An unexpected error occurred."
    );
    problem.setProperty("requestId", requestId);
    return ResponseEntity.internalServerError().body(problem);
}
```

Cuando un user se queja "no me funciona", le pides el `requestId` de la respuesta y vas directo al log relevante. Esto se conecta al doc 09 (Actuator/observability) y al doc 10 (OpenTelemetry traces).

## Trampas comunes

1. **`@Controller` en lugar de `@RestController`** en advices: si pones `@ControllerAdvice` sin el prefijo `Rest`, los handlers que devuelven `ProblemDetail` se interpretan como "nombre de vista" y Spring busca un template. **Siempre** `@RestControllerAdvice` para APIs REST.

2. **Filtrar internals al cliente**: NUNCA pongas `ex.getMessage()` en el detail de un 500. El mensaje puede contener queries SQL, nombres de tablas, paths internos, IDs sensibles. Mensaje genérico ("An unexpected error occurred") + el detalle real en logs.

3. **No tener un fallback `Exception.class`**: si no manejas el caso genérico, Spring devuelve un HTML "Whitelabel Error Page" en lugar de JSON. Confunde a clientes que esperan `application/json`. **Siempre** un handler para `Exception` como red de seguridad.

4. **Confundir `BindException` con `MethodArgumentNotValidException`**:
   - `MethodArgumentNotValidException` — falla `@Valid @RequestBody`.
   - `BindException` — falla validación en form data o `@ModelAttribute`.
   Si solo manejas una, validation errors en otro tipo de input se filtran al fallback `Exception.class` y se logean como 500. Cubre los dos.

5. **`ConstraintViolationException` no se maneja por defecto**: a diferencia de `MethodArgumentNotValidException`, esta (la que se lanza con `@Validated` en params) **no** está en `ResponseEntityExceptionHandler`. Si quieres respuesta consistente, añádela explícitamente al advice.

6. **`@ExceptionHandler` que retorna `void`**: si tu method handler no devuelve `ResponseEntity` ni `ProblemDetail` ni nada, Spring asume 200 con body vacío. Habrá que dejarlo claro:
   ```java
   @ExceptionHandler(Exception.class)
   @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
   public void noResponse(Exception ex) { log.error("...", ex); }   // 500 sin body
   ```

7. **Loguear 4xx como ERROR**: ya cubierto. Spam de alertas.

8. **`@ResponseStatus` sobre excepción + `@ExceptionHandler` del mismo tipo**: si tienes los dos, **gana el `@ExceptionHandler`**. Esto puede ser confuso al debuggear. Si centralizas mapping en el advice, **quita** los `@ResponseStatus` redundantes de las excepciones para evitar drift.

9. **Re-lanzar excepciones desde el advice**: si tu handler tira otra excepción, **no** se vuelve a aplicar el advice — Spring devuelve 500 directamente. El advice es la "última oportunidad" para mapear.

10. **Spring Boot's `BasicErrorController`** interfiere si tu advice no cubre todos los paths: para errores que ocurren **fuera** de un controller (404 en path no mapeado, error de filtro), Spring usa el `BasicErrorController` que devuelve su propio formato. Para personalizarlo, implementa `ErrorController` o configura `error.path` — fuera del scope de este doc.

## Ejercicio

1. **Define las excepciones de dominio**: crea `services/spring-api/src/main/java/com/josemoro/api/users/UserNotFoundException.java` y `EmailAlreadyTakenException.java`. Ambas `extends RuntimeException`. Almacenan el id/email como property para que el advice las exponga en el ProblemDetail.

2. **Refactoriza `UserService`**:
   - `findById(String id)` → `findByIdOrThrow(String id)` lanza `UserNotFoundException`.
   - `create(...)` verifica `repository.existsByEmail(...)` y lanza `EmailAlreadyTakenException` si el email ya está.
   - Borra el `Optional` del controller en favor del `findByIdOrThrow` (más limpio).

3. **Implementa `ApiExceptionHandler`** del ejemplo. Verifica con curls:
   ```bash
   curl -v http://localhost:8080/users/does-not-exist   # → 404 + ProblemDetail
   curl -v -X POST http://localhost:8080/users \
        -H 'content-type: application/json' \
        -d '{"email":"already@taken.com","name":"X"}'  # → 409 si el email está
   ```

4. **Validation handler custom**: añade el handler de `MethodArgumentNotValidException` que devuelve la lista de errores por campo. Prueba con `curl` enviando body con email inválido y verifica que la respuesta incluye `errors: [{field, message}, ...]`.

5. **Request ID end-to-end**: añade un filtro Spring (`OncePerRequestFilter`) que genere/lea `X-Request-Id` por cada request y lo guarde en el MDC de SLF4J. Actualiza el fallback handler para incluirlo en la respuesta + log. Confirma que el mismo `requestId` aparece en logs y en el JSON de error.

6. **Tests del advice con `@WebMvcTest`**: añade tests a `UserControllerTest` que verifiquen:
   - `MockMvc` con body inválido → 400 con `errors` array.
   - `MockMvc` con email duplicado (mock del service) → 409.
   - `MockMvc` con id inexistente → 404.
   Usa `jsonPath("$.errors[0].field").value("email")` para assertions sobre el ProblemDetail.

7. **Reto — `@ProblemDetailFromAnnotation`**: explora la anotación `@ProblemDetailFromAnnotation` (introducida en Spring 6.1) que permite generar ProblemDetail directamente desde las excepciones sin advice. ¿Cuándo lo preferirías? ¿Cuándo no?

## 📖 Lectura paralela

> ⚠️ Esto **no está en el libro** (4ª ed., 2014). `@ControllerAdvice` existía en Spring 3.2, pero `ProblemDetail` (RFC 9457) y la integración nativa son de Spring 6 (2022). Todo lo siguiente es post-libro.

### Estándares

- [RFC 9457 — Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457) — 15 minutos. Léelo entero al menos una vez; es corto y es el contrato que tu API ofrece a sus clientes.
- [RFC 7807 (obsolete)](https://datatracker.ietf.org/doc/html/rfc7807) — versión anterior, todavía referenciada en docs antiguas. RFC 9457 es la actual.

### Documentación oficial

- [Spring Framework Reference — REST Clients and Error Handling](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html) — el chapter oficial sobre exception handling en Spring MVC.
- [Spring Framework Reference — `@ControllerAdvice`](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-advice.html) — scope, ordering, restricciones.
- [Spring Boot Reference — Error Handling](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.error-handling) — interacción con el `BasicErrorController` y propiedades configurables.

### Artículos

- [Baeldung — Exception Handling in Spring](https://www.baeldung.com/exception-handling-for-rest-with-spring) — el tutorial canónico, actualizado a Spring 6.
- [Spring Boot 3 — ProblemDetail Example](https://www.baeldung.com/spring-boot-return-errors-restcontrolleradvice) — focus en el `ProblemDetail` con casos prácticos.

---

**Anterior:** [06 — Testing: `@SpringBootTest`, MockMvc, Testcontainers](./06-testing.md)
**Siguiente:** [08 — Profiles, config externalizada y validation](./08-profiles-y-config.md)
