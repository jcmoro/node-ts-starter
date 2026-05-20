# 06 — Testing: `@SpringBootTest`, MockMvc, Testcontainers

## El problema

Una API Spring tiene **muchas capas** (controller → service → repository → DB) y muchas integraciones implícitas (Jackson serializa, Spring valida, Hibernate mapea, HikariCP gestiona el pool). Probarlas todas es necesario, pero arrancar el contexto entero de Spring para cada test es lento (~2–3s por carga). El compromiso clásico:

- **Tests rápidos pero superficiales** (unit tests sin Spring): pruebas un método aislado en milisegundos. No prueban integración.
- **Tests lentos pero realistas** (`@SpringBootTest` + DB real): pruebas el sistema entero. Caros.
- **Tests intermedios** (slices: `@WebMvcTest`, `@DataJpaTest`): arrancan **parte** del contexto. Compromiso útil.

Spring Boot Test te da herramientas para cada nivel y la convención es **mezclar los tres**:

| Nivel              | Para qué                                    | Velocidad |
|--------------------|---------------------------------------------|-----------|
| Unit (plain JUnit) | Lógica pura, services con mocks             | ~10ms     |
| Slice tests        | Una capa (controller, repo, JSON)           | ~500ms    |
| `@SpringBootTest`  | End-to-end con todo cableado                | ~2–3s     |

Este doc cubre los tres con ejemplos centrados en `services/spring-api/`. Hay un test inicial (`ApplicationTests.java`) que dispara el contexto completo con Testcontainers como smoke — vamos a expandirlo.

## Lo que trae el `spring-boot-starter-test`

Un solo starter en el `pom.xml` trae:

- **JUnit 5** (Jupiter) — el framework de test.
- **Mockito** — mocking.
- **AssertJ** — `assertThat(...).isEqualTo(...)` fluido.
- **Hamcrest** — matchers (`is`, `containsString`, etc.); AssertJ es preferido.
- **JsonPath** — assertions sobre JSON (`$.users[0].email`).
- **MockMvc** — testar controllers sin servidor real.
- **Spring Test** — `@SpringBootTest`, `@MockitoBean`, slice annotations.

Adicionalmente tenemos `spring-boot-testcontainers` y `testcontainers-postgresql` para integración con DB real en contenedor.

## Nivel 1 — Unit tests (sin Spring)

Lo más rápido. JUnit 5 puro, Mockito para los colaboradores. Ejemplo para `UserService`:

```java
package com.josemoro.api.users;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock UserRepository repository;
    @InjectMocks UserService service;

    @Test
    void create_persists_a_new_user_with_a_generated_id() {
        var request = new CreateUserRequest("jose@example.com", "Jose");
        when(repository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        var result = service.create(request);

        assertThat(result.getEmail()).isEqualTo("jose@example.com");
        assertThat(result.getName()).isEqualTo("Jose");
        assertThat(result.getId()).hasSize(36);   // UUID

        verify(repository).save(any(User.class));
    }

    @Test
    void findById_returns_empty_when_not_present() {
        when(repository.findById("missing")).thenReturn(Optional.empty());

        assertThat(service.findById("missing")).isEmpty();
    }
}
```

Cuatro cosas que merecen análisis.

### `@ExtendWith(MockitoExtension.class)`

JUnit 5 usa **extensions** en lugar del `@RunWith` de JUnit 4. `MockitoExtension` activa el procesamiento de `@Mock` y `@InjectMocks`. Sin esta línea, ambos anotadores se ignoran y los mocks son null.

### `@Mock` y `@InjectMocks`

- **`@Mock`** crea un mock de la interface/clase.
- **`@InjectMocks`** instancia la clase real y le **inyecta** los mocks declarados como `@Mock` (por constructor en este caso, ya que `UserService` solo tiene constructor injection).

No hay Spring aquí — todo está en memoria, sin context. Por eso es rápido.

### `when(...).thenAnswer(...)` y `verify(...)`

- **`when(mock.method(args)).thenReturn(x)`** — stubbing: configurar qué devuelve el mock.
- **`.thenAnswer(inv -> inv.getArgument(0))`** — para "devuelve lo que te pasen" (el patrón `save` en repositorios).
- **`verify(mock).method(args)`** — interaction verification: ¿se llamó este método?

> 💡 **AssertJ vs JUnit assertions**: `assertThat(x).isEqualTo(y)` lee mejor que `assertEquals(y, x)` (orden invertido confuso de JUnit). Mensaje de error más útil. **Usa AssertJ por defecto** — viene con el starter, no hay razón para no hacerlo.

### Cuándo usar tests unit

- **Services con lógica de dominio** que no requieren DB/HTTP.
- **Validaciones de records** en su compact constructor (caps. 05).
- **Helpers, utility methods, parsers**.

Si tu service necesita `@Transactional`, Spring proxies, eventos, o auto-config — esto **no lo prueba**. Sube a slice tests.

## Nivel 2 — Slice tests

Slice tests arrancan **una porción** del contexto Spring. Más realista que unit, más rápido que `@SpringBootTest`. Las tres slices más comunes:

### `@WebMvcTest` — solo la capa web

Carga `@Controller`/`@RestController`, Jackson, validation, error handlers. **No** carga `@Service`/`@Repository`/`@Configuration` no-web. Para los services que el controller necesita, los **mockeas** con `@MockitoBean`.

```java
@WebMvcTest(UserController.class)
class UserControllerTest {

    @Autowired MockMvc mockMvc;
    @MockitoBean UserService userService;

    @Test
    void post_users_returns_201_with_the_created_user() throws Exception {
        var created = new User("abc-123", "jose@example.com", "Jose");
        when(userService.create(any())).thenReturn(created);

        mockMvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email":"jose@example.com","name":"Jose"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(header().string("Location", "/users/abc-123"))
            .andExpect(jsonPath("$.id").value("abc-123"))
            .andExpect(jsonPath("$.email").value("jose@example.com"));
    }

    @Test
    void post_users_returns_400_when_email_is_invalid() throws Exception {
        mockMvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email":"not-an-email","name":"Jose"}
                    """))
            .andExpect(status().isBadRequest());
    }
}
```

Detalles:

- **`@MockitoBean`** (Spring 6.2+, Boot 3.4+): registra un mock en el contexto reemplazando el bean real. Es la sustituta de `@MockBean` (deprecated). Funcionalmente lo mismo.
- **`MockMvc`** simula un request HTTP **sin levantar Tomcat** — más rápido y determinístico que un cliente real. La cadena `perform → andExpect → andExpect` es el patrón canónico.
- **`jsonPath("$.id")`** — assertions sobre JSON paths. Útil para no comparar respuestas completas.

> 💡 **Cuándo `@WebMvcTest` brilla**: tests de validación, mapeo de errores HTTP, content negotiation, headers, serialización. Tests que no necesitan DB.

### `@DataJpaTest` — solo la capa JPA

Carga entities, repositories, EntityManager, transactions. **No** carga controllers/services/web. Útil para probar queries custom.

```java
@DataJpaTest
@Testcontainers
class UserRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app");

    @Autowired UserRepository repository;
    @Autowired TestEntityManager em;

    @Test
    void findByEmail_returns_the_matching_user() {
        em.persist(new User("u1", "alice@example.com", "Alice"));
        em.persist(new User("u2", "bob@example.com", "Bob"));
        em.flush();

        var result = repository.findByEmail("alice@example.com");

        assertThat(result).isPresent();
        assertThat(result.get().getName()).isEqualTo("Alice");
    }
}
```

Detalles:

- Por defecto, `@DataJpaTest` usa **H2 in-memory** — pero nuestro código usa features Postgres-específicas (futuro). Mejor anclarse a Postgres real con Testcontainers (ver más abajo).
- **`TestEntityManager`** es un wrapper sobre `EntityManager` para tests: facilita `persist`, `flush`, `clear`, `find`.
- **Transacciones**: cada test se ejecuta en una tx que **se rollbackea al final**. La DB queda limpia para el siguiente test sin necesidad de tear-down.

### `@JsonTest` — solo Jackson

Para verificar que tus DTOs serializan/deserializan correctamente:

```java
@JsonTest
class CreateUserRequestJsonTest {

    @Autowired JacksonTester<CreateUserRequest> json;

    @Test
    void deserializes_from_json() throws Exception {
        var content = """
            {"email":"jose@example.com","name":"Jose"}
            """;

        var result = json.parse(content).getObject();

        assertThat(result.email()).isEqualTo("jose@example.com");
        assertThat(result.name()).isEqualTo("Jose");
    }
}
```

Útil cuando refactorizas DTOs y quieres asegurar el contrato con clientes.

## Nivel 3 — `@SpringBootTest` end-to-end

Arranca el contexto **entero**, incluyendo servidor embebido (opcionalmente real con puerto random). Es lo que ya tenemos en `services/spring-api/src/test/java/com/josemoro/api/ApplicationTests.java`:

```java
@SpringBootTest
@Testcontainers
@ActiveProfiles("test")
class ApplicationTests {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app")
        .withUsername("postgres")
        .withPassword("postgres");

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Test
    void contextLoads() {
        // Smoke test: si el @SpringBootApplication cablea sin errores, pasa.
    }
}
```

Para hacer requests HTTP reales contra el servidor embebido, añade `WebEnvironment.RANDOM_PORT` y `TestRestTemplate` (o `WebTestClient`):

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UserApiE2ETest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired TestRestTemplate restTemplate;

    @Test
    void create_then_read_round_trip() {
        var create = restTemplate.postForEntity(
            "/users",
            new CreateUserRequest("jose@example.com", "Jose"),
            User.class);

        assertThat(create.getStatusCode().value()).isEqualTo(201);
        var id = Objects.requireNonNull(create.getBody()).getId();

        var read = restTemplate.getForEntity("/users/" + id, User.class);
        assertThat(read.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(read.getBody().getEmail()).isEqualTo("jose@example.com");
    }
}
```

`TestRestTemplate` mete las requests por **el** Tomcat real en `RANDOM_PORT`. Es el test más realista — y el más lento. Resérvalo para flujos críticos end-to-end.

## Testcontainers + `@ServiceConnection`

La razón por la que **no usamos H2** en nuestros tests: H2 emula PostgreSQL imperfectamente y oculta bugs que aparecen solo con el motor real (regex `~*`, JSONB, funciones de window). Testcontainers levanta un Postgres real en Docker para cada run.

### `@ServiceConnection` — magia Spring Boot 3.1+

```java
@Container
@ServiceConnection
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
```

`@ServiceConnection` **autocablea** las propiedades del DataSource hacia el container. Sin él, tendrías que escribir manualmente:

```java
@DynamicPropertySource
static void datasourceProps(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", postgres::getJdbcUrl);
    registry.add("spring.datasource.username", postgres::getUsername);
    registry.add("spring.datasource.password", postgres::getPassword);
}
```

`@ServiceConnection` lo automatiza. Es solo para los containers con soporte oficial (Postgres, Redis, MongoDB, Kafka, Elasticsearch, RabbitMQ…) — el resto sigue necesitando `@DynamicPropertySource`.

### Container `static` vs por test

```java
@Container static PostgreSQLContainer<?> postgres = ...;   // se levanta una vez por clase
```

vs

```java
@Container PostgreSQLContainer<?> postgres = ...;          // se levanta para CADA test
```

El segundo aísla mejor pero multiplica el tiempo por N tests. **Static es lo idiomático**: comparte el container entre tests de la clase, y combina con `@Transactional` (rollback automático) para aislar el estado.

### Reusing containers entre clases

Para acelerar runs de muchas clases con la misma DB, añade en `~/.testcontainers.properties`:

```
testcontainers.reuse.enable=true
```

Y en el código:

```java
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
    .withReuse(true);
```

El container persiste entre runs si no cambia su config. Útil en desarrollo local. **Desactiva en CI** (no aporta y complica).

### Schema en tests

Tenemos dos opciones para el schema en tests:

1. **`ddl-auto: create-drop`** (lo que hace `ApplicationTests` actual): Hibernate crea las tablas desde las entities al arrancar y las borra al cerrar. Ventaja: no depende de los archivos SQL del repo. Desventaja: si el schema generado por Hibernate diverge del SQL de producción (cosas como índices custom, defaults SQL específicos), los tests no lo cogen.

2. **Aplicar las migraciones SQL del repo** vía Flyway o un init script:
   ```java
   @Container
   @ServiceConnection
   static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
       .withInitScript("migrations/0001_initial.sql");
   ```
   Más realista. Para producción seria, esto es lo que querrás.

Decisión actual del repo: opción 1 para el smoke test inicial; opción 2 cuando empecemos a tener queries Postgres-específicas.

## Mocking en el contexto Spring

### `@MockitoBean` (Boot 3.4+) y `@MockitoSpyBean`

```java
@WebMvcTest(UserController.class)
class UserControllerTest {
    @MockitoBean UserService userService;
    // ...
}
```

`@MockitoBean` **reemplaza** el bean real (o lo añade si no existe). Internamente usa Mockito. Es el sustituto de `@MockBean` (deprecated en Spring 6.2).

`@MockitoSpyBean` es el equivalente para `Mockito.spy()` — envuelve el bean real interceptando llamadas (útil para verificar interactions sin perder comportamiento).

> 💡 **`@MockitoBean` vs `@Mock`**: el primero registra el mock en el ApplicationContext (necesario para slice tests y `@SpringBootTest`). El segundo es un mock "suelto" (solo unit tests sin Spring). Confundirlos lleva a NPEs raros.

### `@TestConfiguration` para configs específicas de test

Si necesitas reemplazar un `@Bean` por una versión test (sin mockear todos sus métodos), crea una configuración interna:

```java
@SpringBootTest
class UserServiceE2ETest {

    @TestConfiguration
    static class TestClock {
        @Bean Clock clock() { return Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), UTC); }
    }
}
```

El `@Bean` de la `@TestConfiguration` **sobreescribe** al del `@Configuration` principal si la propiedad `spring.main.allow-bean-definition-overriding=true` está activa, o si los registras manualmente con `@Import(TestClock.class)`.

## Estructura de archivos y naming

```
src/test/java/com/josemoro/api/
├── ApplicationTests.java                 ← smoke test que carga el contexto
├── users/
│   ├── UserServiceTest.java              ← unit
│   ├── UserControllerTest.java           ← @WebMvcTest
│   ├── UserRepositoryTest.java          ← @DataJpaTest
│   └── UserApiE2ETest.java               ← @SpringBootTest end-to-end
└── shared/
    └── PostgresIntegrationTest.java      ← base class con @Testcontainers compartida
```

Convención: **un test class por production class**, suffix `Test`. Para tests E2E que cruzan capas, suffix `E2ETest` o `IT` (Integration Test).

`maven-surefire-plugin` ejecuta `*Test.java` en la fase `test`. `maven-failsafe-plugin` ejecuta `*IT.java` en la fase `integration-test`. Si quieres separar suite rápida vs lenta, usa estos suffixes.

## Trampas comunes

1. **`@SpringBootTest` en TODO**: tienta porque "funciona siempre" pero cada test añade 2–3s. Una suite de 50 tests = 2 min solo arrancando contextos. Reserva para tests de integración real; el resto, slice o unit.

2. **`@MockitoBean` vs `@Mock`**: usar `@Mock` dentro de un `@WebMvcTest` deja el bean real en el contexto **y** un mock sin conexión. Síntoma: el test pasa pero el mock no se llama nunca. Fix: `@MockitoBean` en tests con contexto Spring, `@Mock` solo en unit tests con `MockitoExtension`.

3. **Context caching invalidado**: Spring cachea el `ApplicationContext` entre tests con la **misma configuración**. Si cambias propiedades (`@TestPropertySource`, `@DirtiesContext`) entre clases, Spring re-arranca el context. Síntoma: suite lenta. Fix: homogeneiza configs entre clases o usa una base class común.

4. **`@DirtiesContext` como solución mágica**: marca el contexto como "ensuciado" → re-cargar en el siguiente test. Lento. Si lo usas, normalmente hay un bug de aislamiento de estado (singleton mutable, cache) que se podría arreglar de raíz.

5. **No rollbackear en tests `@DataJpaTest` con Testcontainers**: por defecto `@DataJpaTest` hace rollback al final. Si añades `@Transactional(propagation = NOT_SUPPORTED)` o `@Commit`, los tests **leakean** estado a otros. Síntoma: tests pasan en aislado, fallan juntos.

6. **`TestRestTemplate` con paths absolutos**:
   ```java
   restTemplate.getForEntity("http://localhost:8080/users", ...);   // ❌ puerto fijo
   ```
   Usa rutas relativas (`"/users"`) — `TestRestTemplate` resuelve contra el `RANDOM_PORT` automáticamente.

7. **Container que no arranca por falta de Docker**: si CI corre sin Docker, los `@Testcontainers` fallan. Algunas opciones: skip con `@DisabledIfSystemProperty(named = "skipContainers", matches = "true")`, o usar `@EnabledIfDockerAvailable` (con la dep `testcontainers-junit-jupiter`).

8. **JUnit 5 lifecycle confundido con JUnit 4**: en JUnit 5, los métodos `@BeforeEach`/`@AfterEach` reemplazan `@Before`/`@After`. `@BeforeAll`/`@AfterAll` son **estáticos por defecto** (o usar `@TestInstance(PER_CLASS)`).

9. **Imports estáticos olvidados**: `MockMvc` requiere muchos imports estáticos:
   ```java
   import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
   import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
   ```
   Sin ellos, `post(...)`, `status()`, `jsonPath(...)` no existen. Configura tu IDE para auto-imports (IntelliJ: Settings → Editor → Auto Import).

10. **Random ports en CI**: `@SpringBootTest(webEnvironment = RANDOM_PORT)` evita colisiones con servicios locales. Si pones puerto fijo (`8080`) y CI tiene algo escuchando ahí, fallos intermitentes. **Random es el default sano**.

## Ejercicio

1. **`UserServiceTest` unit**: implementa el test del ejemplo. Añade un test extra: cuando `repository.existsByEmail` devuelve true, `create` debería tirar excepción de "email duplicado" (asume que esta validación ya existe o añádela junto con el test). Verifica con `assertThatThrownBy(...)`.

2. **`UserControllerTest` con `@WebMvcTest`**: implementa el ejemplo. Añade casos para:
   - POST con body sin `email` (falta campo) → 400.
   - POST con `name` vacío → 400.
   - GET `/users/{id}` que no existe → 404.

3. **`UserRepositoryTest` con `@DataJpaTest`**: añade un test que persiste 5 users y verifica que `findAll(Pageable.ofSize(2))` devuelve un `Page` con `totalElements=5` y `content.size()=2`.

4. **`UserApiE2ETest` con `@SpringBootTest`**: implementa el round-trip create → read del ejemplo. Añade un test que crea dos users con el **mismo email** y verifica que el segundo POST devuelve 409 (asume que esta lógica existe).

5. **`@TestConfiguration` con `Clock`**: si en el ejercicio del cap. 02 añadiste un `Clock` bean en `AppConfig`, ahora en `UserApiE2ETest` reemplázalo con `Clock.fixed(Instant.parse("2026-01-01T12:00:00Z"))`. Verifica que la respuesta del `/health` devuelve ese timestamp.

6. **Reto — Testcontainers con migraciones SQL**: cambia el `@ServiceConnection` para que **no** use `ddl-auto: create-drop` sino que aplique el archivo `migrations/0001_initial.sql` con `.withInitScript(...)`. Esto prueba contra el **mismo schema** que producción. ¿Qué pasa si el SQL tiene un error de sintaxis?

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014)

- **Capítulo 14 — *Testing Spring applications***: la idea de levels (unit / integration / web) sigue válida, pero las anotaciones cambiaron de nombre y filosofía. `@RunWith(SpringJUnit4ClassRunner.class)` → `@SpringBootTest` (Boot 1.x+). `@WebAppConfiguration` → `@WebMvcTest`.

> ⚠️ El libro precede a `@SpringBootTest` (introducido en Boot 1.4, 2016). La forma de hoy es **muy distinta** — usa la doc oficial para anotaciones específicas.

> ⚠️ El libro usa JUnit 4. Spring Boot 3 viene con JUnit 5 (Jupiter). Diferencias: imports (`org.junit.jupiter.api.*` vs `org.junit.*`), lifecycle annotations (`@BeforeEach` vs `@Before`), assertion style.

### Documentación oficial

- [Spring Boot Reference — Testing](https://docs.spring.io/spring-boot/reference/testing/index.html) — la referencia canónica. Cubre todas las slice annotations y `@SpringBootTest`.
- [Spring Boot Reference — Auto-configured Tests](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html#testing.spring-boot-applications.autoconfigured-tests) — `@WebMvcTest`, `@DataJpaTest`, `@JsonTest` con detalle.
- [Spring Framework Reference — Testing](https://docs.spring.io/spring-framework/reference/testing.html) — `MockMvc`, `TestRestTemplate`, `WebTestClient`.
- [Testcontainers — Spring Boot](https://java.testcontainers.org/modules/spring-boot/) — `@ServiceConnection`, container modules.
- [JUnit 5 User Guide](https://junit.org/junit5/docs/current/user-guide/) — referencia del framework de test.
- [AssertJ — Quick Reference](https://assertj.github.io/doc/) — cheat sheet de fluent assertions.

---

**Anterior:** [05 — Records y sealed classes para el dominio](./05-records-y-sealed-classes.md)
**Siguiente:** [07 — Error handling: `@ControllerAdvice` y `ProblemDetail`](./07-error-handling.md)
