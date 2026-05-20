# 08 — Profiles, config externalizada y validation

## El problema

Una aplicación tiene que arrancar en al menos cuatro entornos distintos:

- **Local dev**: Postgres en `localhost:55432`, logs verbosos, sin TLS.
- **Tests**: Postgres efímero (Testcontainers), DDL `create-drop`, sin métricas reales.
- **Staging**: Postgres gestionado, log level intermedio, OTel a un colector.
- **Producción**: Postgres con réplicas, log conciso, secrets desde un vault.

Hardcodear esto en código no escala. Lo que necesitas:

1. **Configuración externalizada** — los valores vienen de fuera del jar.
2. **Profiles** — un mismo build se comporta distinto según el entorno activo.
3. **Tipado y validación** — la app **no arranca** si la config es incorrecta. Fail-fast.

Spring Boot da todo esto. Este doc cubre el sistema completo y cómo aplicarlo al `services/spring-api/`.

## Property sources y orden de precedencia

Cuando lees `${api.timeout:5000}` en el código, Spring busca el valor en una **cadena ordenada de fuentes**. Las más altas ganan:

```
1. Args CLI                          (--server.port=9000)
2. SPRING_APPLICATION_JSON           (JSON en una variable de entorno)
3. ServletConfig / ServletContext   (deploy en servidores externos)
4. JNDI                              (typically Java EE apps)
5. Java System properties            (-Dserver.port=9000)
6. OS environment variables          (SERVER_PORT=9000)
7. Random props                      (random.uuid, random.int(...))
8. application-{profile}.{yml,properties}   (perfil activo, en orden)
9. application.{yml,properties}      (base)
10. @PropertySource en @Configuration
11. Defaults inline                  (${value:default})
```

Reglas mentales útiles:

- **CLI gana siempre**. Útil para overrides puntuales sin recompilar.
- **Env vars > YAML**. Permite cambiar config sin tocar archivos en el contenedor (Docker, k8s).
- **Profile YAML > base YAML**. Cada profile sobreescribe lo común.
- **Sin profile activo, solo `application.yml`**. El resto se ignora.

> 💡 **Trampa de naming**: el property `app.users.default-page-size` (kebab-case en YAML) es el mismo que `APP_USERS_DEFAULT_PAGE_SIZE` (env var) y que `app.users.defaultPageSize` (en código). Spring aplica **"relaxed binding"** — todas las formas son equivalentes. Usa **kebab-case en YAML** y **SCREAMING_SNAKE en env vars** por convención.

## Profiles

Un profile es **un nombre arbitrario** que activa un conjunto de overrides. Mecanismo:

1. Defines `application-<profile>.yml`.
2. Activas el profile con `SPRING_PROFILES_ACTIVE=<profile>` (env var) o `--spring.profiles.active=<profile>` (CLI).
3. Spring carga el archivo correspondiente y aplica los valores **encima** del `application.yml` base.

En el repo tenemos `application.yml` (base), `application-dev.yml` (Postgres local), `application-prod.yml` (env vars sin defaults). Ejemplo del dev:

```yaml
spring:
  datasource:
    url: ${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:55432/app}
    username: ${SPRING_DATASOURCE_USERNAME:postgres}
    password: ${SPRING_DATASOURCE_PASSWORD:postgres}

logging:
  level:
    root: DEBUG
    org.hibernate.SQL: DEBUG
    org.hibernate.orm.jdbc.bind: TRACE
```

Activación:

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=dev
SPRING_PROFILES_ACTIVE=dev java -jar target/*.jar
```

### Múltiples profiles activos a la vez

Puedes activar varios separados por coma. Spring los aplica **en el orden listado** (el último sobreescribe a los anteriores):

```bash
SPRING_PROFILES_ACTIVE=dev,debug,local-overrides java -jar target/*.jar
```

Útil para componer: `dev` define defaults locales; `debug` añade logging extra; `local-overrides` cambia algo específico para tu máquina.

### `spring.profiles.group` — perfiles compuestos

Si tienes varios profiles que siempre van juntos, declara un **grupo**:

```yaml
# application.yml
spring:
  profiles:
    group:
      production: prod, db-readonly, otel
      local: dev, debug
```

Y luego activas el grupo:

```bash
SPRING_PROFILES_ACTIVE=production
```

Spring resuelve `production` → `[prod, db-readonly, otel]` y aplica los tres.

### `@Profile` sobre beans

Para activar/desactivar beans según el profile:

```java
@Service
@Profile("dev")
public class MockEmailSender implements EmailSender { ... }

@Service
@Profile("!dev")              // todo menos dev
public class SmtpEmailSender implements EmailSender { ... }

@Service
@Profile({"staging", "prod"})  // dos profiles
public class RealEmailSender implements EmailSender { ... }
```

Útil para inyectar implementaciones distintas (mock en dev, real en prod) sin tocar el resto del código.

### Profiles "default" e "implícitos"

- Sin `SPRING_PROFILES_ACTIVE` set, Spring activa **`default`** automáticamente. Puedes definir `application-default.yml` o `@Profile("default")` beans.
- **No actives un profile dentro de `application.yml`** (`spring.profiles.active: dev`). Es un anti-patrón — significa que tu profile "neutro" en realidad no lo es. Activación siempre **desde fuera**: env var o CLI.

## `@Value` — la forma vieja (limitada)

Inyectar properties directamente en beans:

```java
@Service
public class ApiClient {

    @Value("${api.endpoint}")
    private String endpoint;

    @Value("${api.timeout:5000}")
    private int timeoutMs;

    @Value("${api.allowed-origins}")
    private List<String> allowedOrigins;
}
```

Funciona pero tiene problemas:

- **No tipado en compile-time**: el property puede no existir en runtime → `IllegalArgumentException` al cablear el bean.
- **Default inline** (`:5000`) es la única validación.
- **Sin agrupación**: 30 properties → 30 `@Value` en una clase. Ruidoso.
- **No funciona con records** (no hay setter, `@Value` necesita field/setter injection).

Hoy es **un fallback** para casos puntuales (inyectar una sola property muy específica). Para config seria, `@ConfigurationProperties`.

## `@ConfigurationProperties` — el patrón moderno

Mapea un grupo de properties a un **record inmutable y tipado**:

```java
// application.yml
app:
  users:
    default-page-size: 50
    max-page-size: 200
    allow-self-registration: false
```

```java
package com.josemoro.api.users;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.users")
public record UsersConfig(
    int defaultPageSize,
    int maxPageSize,
    boolean allowSelfRegistration
) {}
```

Luego lo registras (dos opciones, elige una):

**Opción A** — `@EnableConfigurationProperties` puntual:

```java
@Configuration
@EnableConfigurationProperties(UsersConfig.class)
public class AppConfig { }
```

**Opción B** — `@ConfigurationPropertiesScan` global (recomendada):

```java
@SpringBootApplication
@ConfigurationPropertiesScan("com.josemoro.api")
public class Application { ... }
```

Y lo inyectas como cualquier bean:

```java
@Service
public class UserService {

    private final UserRepository repository;
    private final UsersConfig config;

    public UserService(UserRepository repository, UsersConfig config) {
        this.repository = repository;
        this.config = config;
    }

    public Page<User> list(int page, int requestedSize) {
        var size = Math.min(requestedSize, config.maxPageSize());
        return repository.findAll(PageRequest.of(page, size));
    }
}
```

### Records con `@ConfigurationProperties` — Spring Boot 3+

En Boot 2.x necesitabas `@ConstructorBinding` para que records funcionaran. **En Boot 3+ es automático** — cualquier clase con un único constructor (incluyendo records) se bindea por constructor. Si la clase tiene varios constructores, marca con `@ConstructorBinding` cuál usar.

### Relaxed binding y nested config

YAML kebab-case se mapea a camelCase de Java automáticamente:

```yaml
app:
  rate-limit:
    requests-per-minute: 60
    burst-size: 10
```

```java
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitConfig(int requestsPerMinute, int burstSize) {}
```

Y para configs anidadas:

```yaml
app:
  email:
    smtp:
      host: smtp.example.com
      port: 587
    sender: noreply@example.com
```

```java
@ConfigurationProperties(prefix = "app.email")
public record EmailConfig(SmtpConfig smtp, String sender) {

    public record SmtpConfig(String host, int port) {}
}
```

Limpio, tipado, navegable en el IDE.

## Validación de config: fail fast

El error más común con config es **descubrir un valor inválido en producción a las 3am** (faltó una env var, el puerto era string en lugar de int, la URL no es válida). La cura es **validar al arrancar y matar el proceso** si algo falla.

`@ConfigurationProperties` + `@Validated` + `jakarta.validation` lo hace:

```java
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties(prefix = "app.users")
@Validated
public record UsersConfig(
    @Min(1) int defaultPageSize,
    @Min(1) int maxPageSize,
    boolean allowSelfRegistration
) {}
```

Si `application.yml` tiene `default-page-size: 0`, Spring **falla al arrancar** con:

```
Failed to bind properties under 'app.users' to UsersConfig:
    Reason: Value must be at least 1
    Action: Update your application's configuration
```

El proceso muere. No llega a aceptar requests con config rota.

Constraints útiles para config:

| Constraint                   | Para                                          |
|------------------------------|-----------------------------------------------|
| `@NotBlank`                  | Strings que no pueden ser vacíos              |
| `@Min(n)` / `@Max(n)`        | números                                       |
| `@Positive` / `@PositiveOrZero` | números                                    |
| `@Pattern(regexp = "...")`   | URLs, emails con formato estricto             |
| `@NotNull`                   | tipos object que deben venir                  |
| Composición anidada con `@Valid` | configs internas                          |

> 💡 **Por qué fail-fast es mejor que defaults defensivos**: si tu código tiene `Math.max(1, config.maxPageSize())` para "tolerar" un valor malo, ocultas el bug. Cuando alguien deploye con `max-page-size: 0` pensando que "0 = ilimitado", obtienes silenciosamente `max-page-size: 1` y nadie se entera. Mejor que la app no arranque y el deploy falle en CI/CD.

## Externalized config en práctica

### En desarrollo local

`application-dev.yml` con defaults razonables. Override puntual con env vars o CLI args:

```bash
LOGGING_LEVEL_ROOT=TRACE mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

### En contenedores (Docker, k8s)

Pasa env vars al container:

```yaml
# docker-compose.yml
services:
  spring-api:
    environment:
      SPRING_PROFILES_ACTIVE: prod
      SPRING_DATASOURCE_URL: jdbc:postgresql://db.internal:5432/app
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD}   # del shell o secrets
```

El profile **prod** exige los valores. Si faltan, Spring falla al arrancar — exactamente lo que quieres.

### Secrets

**Nunca** committees secrets en el repo. Opciones por orden de robustez:

1. **`.env` local + `.gitignore`** — para dev.
2. **CI/CD secrets** (GitHub Actions secrets, GitLab variables) inyectadas como env vars.
3. **Secrets manager** (Vault, AWS Secrets Manager, GCP Secret Manager) — Spring Cloud Vault o init container que extrae secrets y los expone como env vars.

Spring Boot 3.4 introdujo `spring.config.import: vault:...` y placeholders nativos para Vault. Para producción seria, ve a esa ruta.

### Property placeholders avanzados

Spring soporta varios formatos de placeholder en YAML:

```yaml
# Env var con default:
url: ${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:55432/app}

# Anidación:
url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:app}

# Random value:
session-key: ${random.uuid}
boot-id: ${random.int(1, 1000)}

# Referencia a otro property:
log-file: ${app.dir}/${spring.application.name}.log
```

## Trampas comunes

1. **`SPRING_PROFILES_ACTIVE` set dentro de `application.yml`**: anti-patrón. Significa que tu archivo "base" no es base. El profile activo siempre se decide **fuera** (env var, CLI, IDE run config).

2. **Profile no se carga (typo en filename)**: si activas `dev` pero el archivo se llama `application-Dev.yml` o `application-development.yml`, Spring no lo encuentra. **Filenames son sensibles a mayúsculas**. Verifica con `--debug` al arrancar.

3. **`@Value` con record**: no funciona — los records no tienen setters ni constructor parameter resolution para `@Value`. Para records usa `@ConfigurationProperties`.

4. **`@ConfigurationProperties` sin registro**: si te olvidas de `@EnableConfigurationProperties` o `@ConfigurationPropertiesScan`, Spring nunca crea el bean. Síntoma: `NoSuchBeanDefinitionException` al inyectar la clase. Fix: o uno o el otro, **uno de los dos es obligatorio**.

5. **`@Value` no se "re-evalúa"**: si cambias una env var después del arranque, el `@Value` no se actualiza (es un snapshot del valor al construir el bean). Para config dinámica necesitas `@RefreshScope` (Spring Cloud) o reiniciar.

6. **Naming inconsistente**: mezclar `kebab-case`, `camelCase` y `snake_case` en el mismo YAML funciona por relaxed binding, pero es ruido. **Convención**: `kebab-case` en YAML siempre.

7. **`@ConfigurationProperties` con field validation sin `@Validated` a nivel clase**: las constraints en los componentes del record **se ignoran** si la clase no lleva `@Validated`. Es exactamente la misma trampa que con `@Validated` en controllers (cap. 03).

8. **`@ConfigurationProperties` con record con varios constructores**: si añades un constructor extra (factory, conveniencia), Spring no sabe cuál usar. Marca el canonical con `@ConstructorBinding` explícito.

9. **Profile en tests no se activa**: `@SpringBootTest` no respeta `SPRING_PROFILES_ACTIVE` del entorno por defecto. Usa `@ActiveProfiles("test")` en la clase de test (lo viste en `ApplicationTests.java`).

10. **`application.properties` vs `application.yml`** ambos presentes: si pones los dos, Spring carga **los dos** y el `.properties` tiene precedencia sobre el `.yml` cuando hay conflicto. **Elige uno** y stick. La convención actual es YAML.

11. **Variables de entorno con guiones**: las env vars **no pueden tener guiones** en su nombre. `SPRING_DATASOURCE_URL` (válido) ≠ `spring-datasource-url` (inválido). Spring traduce automáticamente: `app.rate-limit.requests-per-minute` se mapea desde `APP_RATELIMIT_REQUESTSPERMINUTE` o `APP_RATE_LIMIT_REQUESTS_PER_MINUTE`.

## Ejercicio

1. **`UsersConfig` con `@ConfigurationProperties`**: implementa el record del ejemplo (`defaultPageSize`, `maxPageSize`, `allowSelfRegistration`). Activa el scan con `@ConfigurationPropertiesScan` en `Application.java`. Añade las properties al `application.yml` base. Inyecta `UsersConfig` en `UserService` y usa `config.maxPageSize()` para limitar el `size` en `list(...)`.

2. **Validation que falla**: añade `@Validated` y `@Min(1)` a los campos numéricos del `UsersConfig`. Pon `default-page-size: 0` en `application.yml` y arranca. ¿Qué error sale? Vuélvelo a 50.

3. **Profile `staging`**: crea `application-staging.yml` con un `app.users.max-page-size: 50` (más conservador que el default 200). Arranca con `SPRING_PROFILES_ACTIVE=staging` y verifica que el endpoint `GET /users?size=100` se trunca a 50.

4. **`@Profile` para mockear email en dev**:
   - Crea `interface EmailSender { void send(String to, String body); }`.
   - Una implementación `LoggingEmailSender` (`@Service @Profile("dev")`) que solo loguea.
   - Otra `SmtpEmailSender` (`@Service @Profile("!dev")`) que (de momento) tira `UnsupportedOperationException`.
   - Inyecta `EmailSender` en algún sitio y observa qué bean se cablea según el profile.

5. **Compose profile groups**: en `application.yml`, define:
   ```yaml
   spring:
     profiles:
       group:
         local-debug: dev, debug
   ```
   Crea un `application-debug.yml` con `logging.level.com.josemoro: TRACE`. Activa con `SPRING_PROFILES_ACTIVE=local-debug` y verifica que `dev` Y `debug` se aplican.

6. **Validate cleanly**: cambia `application-prod.yml` para que **no** tenga defaults para `SPRING_DATASOURCE_URL`. Arranca con `SPRING_PROFILES_ACTIVE=prod` sin setear la variable. Confirma que Spring muere con un error claro de "property not found".

7. **Reto — random secret**: añade `app.session-secret: ${random.uuid}` al `application.yml`. Inyéctalo como `@Value("${app.session-secret}")` en algún bean (singleton). Confirma que el valor es **el mismo durante el ciclo de vida** y **distinto en cada arranque**.

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014)

- **Capítulo 16 — *Working with Spring Boot***: la introducción a profiles y configuration externalization sigue siendo válida a nivel conceptual.

> ⚠️ El libro precede a `@ConfigurationProperties` con records (Spring Boot 2.2+, 2019) y a `@ConfigurationPropertiesScan` (Boot 2.2+). La forma moderna (records inmutables + validation + scan global) está muy alejada de lo que el libro propone (`@Value` + clases mutables con setters).

> ⚠️ `spring.profiles.group` es de Boot 2.4+ (2020). El libro usa el sistema viejo de "include profiles", que sigue funcionando pero está siendo deprecado.

### Documentación oficial

- [Spring Boot Reference — Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html) — la referencia canónica. Cubre property sources, profiles, `@ConfigurationProperties`, validation. Probablemente el chapter de Boot más útil para tener bookmarked.
- [Spring Boot Reference — Profiles](https://docs.spring.io/spring-boot/reference/features/profiles.html) — profiles activos, default, include, groups, `@Profile`.
- [Spring Framework Reference — `@PropertySource`](https://docs.spring.io/spring-framework/reference/core/beans/environment.html#beans-using-propertysource) — el mecanismo de bajo nivel.

### Artículos

- [Baeldung — Guide to @ConfigurationProperties](https://www.baeldung.com/configuration-properties-in-spring-boot) — actualizado a Boot 3 con records.
- [Spring Blog — Spring Boot Config Hierarchical Properties](https://spring.io/blog/2020/04/23/spring-tips-the-spring-boot-application-properties-deep-dive) — deep dive en el orden de precedencia con ejemplos.

---

**Anterior:** [07 — Error handling: `@ControllerAdvice` y `ProblemDetail`](./07-error-handling.md)
**Siguiente:** [09 — Actuator, Micrometer y Prometheus](./09-actuator-micrometer-prometheus.md)
