# 02 — DI y beans: IoC container, autowiring, scopes

## El problema

Imagina escribir una app Java sin ningún framework de DI. Cada vez que necesitas un servicio, lo construyes a mano:

```java
public class Bootstrap {
    public static void main(String[] args) {
        var dataSource = new HikariDataSource(buildHikariConfig());
        var entityManagerFactory = buildEMF(dataSource);
        var transactionManager = new JpaTransactionManager(entityManagerFactory);

        var userRepository = new UserRepository(entityManagerFactory);
        var emailSender = new SmtpEmailSender(loadSmtpConfig());
        var auditLogger = new AuditLogger(buildLogWriter());

        var userService = new UserService(userRepository, emailSender, auditLogger);
        var userController = new UserController(userService);

        startServer(userController);
    }
}
```

Esto es DI **manual**. Ventajas: explícito, sin magia, fácil de testear (le pasas mocks al constructor). Desventajas:

- Cuando hay 30 servicios cada uno con 3–5 dependencias, el `main` se vuelve un grafo enorme.
- Cualquier dep nueva en una clase profunda obliga a tocar el `main`.
- Resolver el orden de construcción correcto (este antes que ese) lo haces a mano.

Antes de Spring, en Java había patrones para mitigar esto:
- **Service Locator** (un singleton con `getInstance()` por tipo) — funciona pero acopla todo a un registry global.
- **Factory Method** — diluye la creación entre muchas factories sin coordinar el grafo.

Spring resuelve esto con un **IoC container** (Inversion of Control): tú declaras qué clases son "gestionables" y cuáles necesitan a cuáles, y el container monta el grafo por ti.

> 💡 **El nombre "Inversion of Control"**: en lugar de **tú** crear las instancias y pasárselas a quien las necesite (control normal), las creas declarándolas y **el framework** decide cuándo construirlas y cómo conectarlas (control invertido). El framework te llama a ti, no al revés.

## El ApplicationContext

El container de Spring se llama **ApplicationContext**. Es un grafo de objetos (los **beans**) que Spring construye al arrancar:

```
ApplicationContext
├── userController     ← creado para responder a /users
├── userService        ← inyectado en userController
├── userRepository     ← inyectado en userService (auto-impl por Spring Data)
├── dataSource         ← inyectado en userRepository (HikariCP, auto-config)
├── entityManagerFactory
├── objectMapper       ← bean de Jackson, auto-config
├── tomcatServletWebServerFactory
└── ...cientos más
```

Cuando llega un request a `/users`, Spring usa **el** `userController` ya construido. Cuando `userController` necesita `userService`, Spring le pasa **el** `userService` ya construido. No hay `new` en tu código de aplicación — Spring lo hace por ti.

Para inspeccionar el contexto vivo:

```bash
curl http://localhost:8080/actuator/beans   # si expones 'beans' (ej. 4 del cap. 01)
```

Verás los cientos de beans gestionados.

## Constructor injection — la única forma idiomática

Mira `services/spring-api/src/main/java/com/josemoro/api/users/UserService.java`:

```java
@Service
public class UserService {

    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }
    // ...
}
```

Tres cosas que merecen atención:

### 1. `@Service` declara el bean

`@Service` le dice a Spring: "esta clase es un bean, gestiona su ciclo de vida". El `@ComponentScan` la encuentra al arrancar (recuerda: empieza desde el package de `Application.java`).

### 2. El constructor define las dependencias

Spring ve `public UserService(UserRepository repository)` y razona:

> "Para construir un `UserService` necesito un `UserRepository`. ¿Tengo uno en el contexto? Sí → se lo paso."

**Esto se llama autowiring**. Spring lo hace sin `@Autowired` explícito desde Spring 4.3 — si una clase tiene **un solo constructor** público, Spring lo usa automáticamente.

> 💡 **Si vienes del libro (2014)** verás `@Autowired` sobre fields o setters. **No lo hagas**. Pre-4.3 era necesario, hoy es ruido y oculta el shape de la clase. Más sobre esto en Trampas.

### 3. `private final` — inmutabilidad

`final` garantiza que la referencia no puede reasignarse. Es **idiomático en Spring moderno**:

- No hay setter — no se puede cambiar la dep en runtime.
- El compilador te obliga a inicializarla en el constructor.
- Indica que el bean es **stateless** (otra convención: los `@Service` no guardan estado mutable).

## Stereotype annotations: `@Service`, `@Repository`, `@Controller`

Todas son **especializaciones** de `@Component`. Es decir, son funcionalmente equivalentes — todas registran la clase como bean. La diferencia es **semántica**:

```java
@Component                  // genérico (rara vez se usa solo)
@Service                    // lógica de negocio
@Repository                 // acceso a datos
@Controller                 // capa web (devuelve vistas o redirects)
@RestController             // = @Controller + @ResponseBody (devuelve JSON)
```

> 💡 **¿Importa cuál usas?** En la mayoría de casos no — el comportamiento es idéntico. Pero `@Repository` activa un beneficio extra: **traducción automática de excepciones JPA** a `DataAccessException` de Spring. Eso te abstrae del driver concreto (Hibernate → Spring's exception hierarchy). Para `@Service`, es solo señalización.

Convención que recompensa el código que se lee solo:

```
controllers/  → @RestController
services/     → @Service
repositories/ → @Repository (o interfaces que extienden JpaRepository)
```

`UserController`, `UserService`, `UserRepository` siguen este patrón en el repo. Cada anotación cuenta una historia sobre **dónde encaja** la clase en la arquitectura.

## `@Configuration` y `@Bean` — para lo que no controlas

¿Y si quieres añadir al contexto un objeto **de una librería que no es tuya**? No puedes anotarlo. Ahí entran `@Configuration` y `@Bean`:

```java
@Configuration
public class AppConfig {

    @Bean
    public Clock clock() {
        // java.time.Clock no es nuestra clase — no podemos ponerle @Component.
        // Pero la queremos como bean para mockearla en tests.
        return Clock.systemUTC();
    }

    @Bean
    public RestClient externalApiClient() {
        return RestClient.builder()
            .baseUrl("https://api.external.com")
            .build();
    }
}
```

Después puedes inyectar:

```java
@Service
public class TimestampService {

    private final Clock clock;

    public TimestampService(Clock clock) {
        this.clock = clock;
    }
}
```

### Cuándo `@Component` vs `@Bean`

| Caso                                          | Anotación               |
|-----------------------------------------------|-------------------------|
| Tu clase, tu servicio de negocio              | `@Service` (@Component) |
| Tu clase, repositorio                         | `@Repository`            |
| Clase de librería (`Clock`, `RestClient`)     | `@Bean` en `@Configuration` |
| Múltiples instancias del mismo tipo           | `@Bean` con `name` distinto |
| Bean condicional (`@ConditionalOnProperty`)   | `@Bean` casi siempre    |

Regla práctica: **`@Component` si la clase es tuya, `@Bean` si no**.

## Bean scopes

Por defecto, **un bean = un singleton dentro del ApplicationContext**. Mismo objeto para toda la app, durante toda su vida. Esto es **lo correcto en el 99% de los casos** — controladores, servicios, repositorios no tienen estado mutable y reutilizar la misma instancia ahorra memoria y construcción.

Otros scopes (raros pero útiles):

```java
@Service
@Scope(BeanDefinition.SCOPE_PROTOTYPE)   // nueva instancia cada vez que se pide
public class TransientProcessor { ... }

@Component
@RequestScope                             // una instancia por HTTP request
public class RequestContext { ... }

@Component
@SessionScope                             // una instancia por sesión HTTP
public class UserSession { ... }
```

Cuándo cambiar el scope:

- **Prototype**: objeto con estado mutable corto, o construido caro pero distinto cada vez (un parser, un buffer).
- **RequestScope**: contexto por request (request ID, user actual, locale). Más limpio que pasarlo por todos los métodos.
- **SessionScope**: carrito de compra, preferencias de UI antes de persistir.

Si te pillas pensando "este bean necesita estado mutable", **probablemente no debe ser un bean** — pásalo como parámetro o usa un `Map` en un singleton.

## Wiring múltiples beans del mismo tipo

Cuando hay más de un bean implementando la misma interface, Spring no sabe cuál inyectar. Tres soluciones:

### `@Primary` — el por defecto

```java
@Service
@Primary
public class StandardEmailSender implements EmailSender { ... }

@Service
public class TestEmailSender implements EmailSender { ... }   // se ignora salvo @Qualifier
```

Cuando un caller pide `EmailSender`, Spring le da el `@Primary`.

### `@Qualifier` — elección explícita

```java
@Service
@Qualifier("smtp")
public class SmtpEmailSender implements EmailSender { ... }

@Service
@Qualifier("sendgrid")
public class SendgridEmailSender implements EmailSender { ... }

@Service
public class NotificationService {
    public NotificationService(@Qualifier("sendgrid") EmailSender sender) {
        // ...
    }
}
```

### `List<EmailSender>` — recibir todos

```java
@Service
public class BroadcastService {
    private final List<EmailSender> senders;

    public BroadcastService(List<EmailSender> senders) {
        this.senders = senders;
    }

    public void notify(String msg) {
        senders.forEach(s -> s.send(msg));
    }
}
```

Spring te inyecta una `List` con **todos** los beans del tipo. Excelente para **strategy pattern** o cuando hay plugins extensibles.

## Inyección por field y por setter (NO LO HAGAS)

```java
// ❌ Field injection — anti-patrón moderno
@Service
public class UserService {
    @Autowired
    private UserRepository repository;
}

// ❌ Setter injection — útil solo en casos muy concretos
@Service
public class UserService {
    private UserRepository repository;

    @Autowired
    public void setRepository(UserRepository repository) {
        this.repository = repository;
    }
}
```

Por qué evitarlas:

1. **No es `final`**: la dep puede reasignarse, lo cual rompe la inmutabilidad.
2. **Oculta deps**: las deps de la clase no son visibles en el constructor. Para entender qué necesita, hay que leer todos los fields.
3. **Tests más feos**: para construirla en un test sin Spring necesitas reflexión o `ReflectionTestUtils`. Con constructor injection, `new UserService(mockRepo)` y ya está.
4. **Circular dependencies**: con constructor injection, Spring **falla al arrancar** si hay un ciclo (bueno). Con field injection puede pasar desapercibido hasta que crashea en runtime.

El **único** caso donde setter injection es razonable: una dep **opcional** que puedes querer cambiar. Y aún así, considera un `@Bean` en `@Configuration` o un wrapper.

## Lifecycle hooks

Si necesitas ejecutar código al construirse el bean o al destruirse el contexto:

```java
@Service
public class CacheService {

    @PostConstruct
    public void warmup() {
        // se llama después de inyectar todas las deps
        loadCacheFromDisk();
    }

    @PreDestroy
    public void shutdown() {
        // se llama al cerrar el ApplicationContext
        flushCacheToDisk();
    }
}
```

Útil para warmup, cleanup, registrar listeners, conectar a un service externo en startup, etc.

> 💡 **Spring Boot tiene un sistema más nuevo** vía eventos (`ApplicationReadyEvent`, `ContextClosedEvent`) que es más flexible. `@PostConstruct` sigue siendo válido para inicialización **de un bean concreto**; los eventos son para reaccionar a fases del ciclo de vida **de la app entera**.

## Trampas comunes

1. **`new` en lugar de inyección**:
   ```java
   @Service
   public class UserService {
       private final EmailSender sender = new SmtpEmailSender(); // ❌
   }
   ```
   El `EmailSender` que construyes a mano **no es** un bean. No tiene transactional support, no aparece en el contexto, no se puede mockear con `@MockBean`. Pídelo por constructor.

2. **`@Autowired` sobre field**: ver sección anterior. Heredado del libro 2014 — **no** en código nuevo.

3. **Forgetting `@Configuration` con `@Bean`**:
   ```java
   public class AppConfig {   // ❌ falta @Configuration
       @Bean public Clock clock() { return Clock.systemUTC(); }
   }
   ```
   Sin `@Configuration`, los `@Bean` no se registran. La clase debe ser un bean ella misma (por `@Component` o `@Configuration`) para que Spring procese sus methods.

4. **Inyección en `static`**:
   ```java
   @Service
   public class UserService {
       @Autowired
       private static UserRepository repo;   // ❌
   }
   ```
   Spring **no puede** inyectar en fields static — pertenecen a la clase, no a una instancia. Síntoma: `NullPointerException` cuando se usa. Si necesitas algo "global", inyéctalo en el constructor y guárdalo en un field de instancia.

5. **Ciclos de dependencia**:
   ```java
   @Service public class A { public A(B b) {...} }
   @Service public class B { public B(A a) {...} }
   ```
   Spring **falla al arrancar** con "Requested bean is currently in creation: Is there an unresolvable circular reference?". Bueno: te avisa rápido. La cura es siempre **rediseñar** (extraer una interface, mover método a un tercer bean). Resistir la tentación de `@Lazy` para parchearlo — eso oculta un problema de diseño.

6. **Múltiples beans sin `@Primary` ni `@Qualifier`**:
   ```
   No qualifying bean of type 'EmailSender' available: expected single matching bean but found 2: smtp, sendgrid
   ```
   Anota uno con `@Primary` o usa `@Qualifier` en el caller.

7. **`@ComponentScan` no llega al package**:
   Si la clase con `@Service` está en `com.otherorg.shared.utils` y tu `Application.java` en `com.josemoro.api`, Spring no la ve. Añade `@ComponentScan(basePackages = {"com.josemoro.api", "com.otherorg.shared"})` o, mejor, **mueve la clase** a tu árbol de packages.

8. **`@Service` sobre una clase abstracta o interface**:
   Spring no construye abstractas. Las **interfaces** sí pueden anotarse, pero solo si Spring sabe cómo implementarlas (es el caso de `JpaRepository` — Spring Data genera la impl). En el resto de casos, anota la clase concreta.

## Ejercicio

1. **Añade un `Clock` bean**: crea `services/spring-api/src/main/java/com/josemoro/api/AppConfig.java`:
   ```java
   @Configuration
   public class AppConfig {
       @Bean public Clock clock() { return Clock.systemUTC(); }
   }
   ```
   Inyéctalo en `HealthController` y usa `clock.instant()` en lugar de `Instant.now()` en el endpoint `/health`. ¿Por qué pasarlo así? Porque ahora puedes inyectar un `Clock.fixed(...)` en tests y verificar la respuesta del endpoint con un timestamp determinístico.

2. **Inspecciona el grafo en vivo**: añade `beans` a la lista de Actuator expuestos (cap. 01 ejercicio 4) y `curl /actuator/beans | jq '.contexts.application.beans.userController.dependencies'`. Verás `["userService"]`. Repite con `userService`: dependencia `["userRepository"]`.

3. **Múltiples impls de una interface**: crea `interface Greeter { String greet(String name); }` y dos implementaciones (`@Service` cada una): `EnglishGreeter` y `SpanishGreeter`. Marca una como `@Primary`. Inyéctala en `HealthController` y prueba un endpoint nuevo `/hello/{name}`. Luego cambia a `@Qualifier("spanish")` y observa qué pasa.

4. **`List<Greeter>` injection**: cambia el controller para inyectar `List<Greeter>` y devolver todos los saludos. Confirma que Spring te pasa los dos en una lista — sin que tú la construyas.

5. **Reto — ciclo de dependencias**: intenta crear `class A { A(B b) }` y `class B { B(A a) }`, ambas `@Service`. Arranca y mira el error. Lee el stack trace y entiende qué dice. Luego rediseña con una interface y un tercer bean coordinador.

6. **`@PostConstruct` en práctica**: añade un `@PostConstruct` en `UserService` que `log.info("UserService ready")`. Confirma en los logs cuándo se ejecuta — antes o después de "Tomcat started"?

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014)

- **Capítulo 2 — *Wiring beans***: lee la sección "Automatically wiring beans" (la del `@Autowired` por constructor sigue vigente). **Salta** XML configuration y `@ImportResource`.
- **Capítulo 3 — *Advanced wiring***: scopes, profiles condicionales, `@Conditional`. El concepto está bien — la sintaxis específica de Boot 3 puede haber cambiado.

> ⚠️ El libro insiste en field injection con `@Autowired`. **Ignóralo**. Spring 4.3 (junio 2016) introdujo la inferencia por constructor único, y todo el ecosistema migró a constructor injection. El libro está pre-4.3.

### Documentación oficial

- [Spring Framework Reference — The IoC Container](https://docs.spring.io/spring-framework/reference/core/beans.html) — la referencia canónica. 30 min para los conceptos clave.
- [Spring Framework — Java-based Container Configuration](https://docs.spring.io/spring-framework/reference/core/beans/java.html) — `@Configuration` y `@Bean` a fondo.
- [Baeldung — Constructor Injection in Spring](https://www.baeldung.com/constructor-injection-in-spring) — el "por qué constructor" con ejemplos prácticos.

---

**Anterior:** [01 — Setup: Maven, Boot 3, Java 21, project layout](./01-setup.md)
**Siguiente:** [03 — Controllers y Bean Validation](./03-controllers-y-validation.md)
