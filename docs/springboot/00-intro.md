# 00 — Introducción al track Spring Boot

## Qué es esto

Una guía práctica de **Spring Boot 3.x moderno** para devs Java que vienen de Spring 4 / Boot 1.x o que llevan tiempo sin tocar el ecosistema. El código vive en `services/spring-api/` y avanza junto con los capítulos: cada doc explica algo que **ya está implementado** en ese módulo.

## Para quién es esto

- Sabes Java (>= 11). Si solo conoces Java 8, vas a ver mucho azúcar nuevo (`var`, records, sealed classes, pattern matching, virtual threads).
- Has tocado Spring "clásico" alguna vez (XML, applicationContext.xml, Spring 4 con anotaciones) o quieres ver cómo se construye una API REST sobre Spring Boot 3 desde cero.
- Te interesa **qué cambió** entre la forma de hacer Spring del libro de 2014 y cómo se hace hoy con Boot 3.x.

## Importante: el libro vs Spring Boot 3.x

(`Craig Walls — Spring in Action, 4ª ed, 2014`) cubre **Spring 4 / Boot 1.x**. La sintaxis y los patrones modernos divergen mucho:

| Tema                | Libro (2014)                            | Spring Boot 3.x (2025)                       |
|---------------------|-----------------------------------------|----------------------------------------------|
| Java                | 7/8                                     | 21 (LTS, virtual threads, records, sealed)   |
| Spring core         | 4.x                                     | 6.x (`jakarta.*` en vez de `javax.*`)         |
| Spring Boot         | 1.x                                     | 3.4.x                                        |
| Persistence         | Hibernate + Spring Data                 | Spring Data JPA, Hibernate 6 (nullable info) |
| Configuration       | XML / `@Configuration`                  | `application.yml` + `@ConfigurationProperties` |
| DTOs                | Clases con getters/setters              | Records                                       |
| Validation          | Bean Validation (`javax.validation`)    | `jakarta.validation`                          |
| Web                 | Spring MVC + JSP                        | Spring MVC + REST + WebFlux opcional         |
| Build               | Maven (sin Boot plugin)                 | Maven + `spring-boot-maven-plugin` (layered) |
| Containers          | No tratado                              | Buildpacks / multi-stage Dockerfile          |
| Observability       | No tratado                              | Actuator + Micrometer + OTel                 |
| Testing             | JUnit 4 + Mockito                       | JUnit 5 + Mockito + Testcontainers           |

Usaremos el libro como **mapa de conceptos** (qué es IoC, qué es JPA, qué es una transacción Spring), pero el código y el tooling apuntan a Boot 3.x. Cuando el libro proponga un patrón anticuado, lo señalaremos y daremos la versión moderna.

## Convenciones

- **Términos técnicos en inglés** (`bean`, `context`, `dependency injection`, `repository`, `controller advice`, `actuator`).
- **Comentarios en el código** en inglés.
- **Prosa** en español.

## Estructura de cada capítulo

1. **Problema** — qué resuelve.
2. **Cómo lo resuelve Spring Boot** — con snippets del `services/spring-api/`.
3. **Trampas** — qué sorprende viniendo de Java pre-Boot.
4. **Ejercicio**.
5. **📖 Lectura paralela**:
   - Sección del *Spring in Action* (4ª ed), con nota sobre lo que está desactualizado.
   - [Spring Boot Reference](https://docs.spring.io/spring-boot/) y [Spring Framework Reference](https://docs.spring.io/spring-framework/reference/).

## Plan curricular

Track completo (14 docs). Todos publicados.

| Doc                                              | Tema                                                       | Capítulo del libro |
|--------------------------------------------------|------------------------------------------------------------|--------------------|
| ✅ 00 (este)                                      | Introducción al track Spring Boot                          | Prefacio + cap. 1  |
| ✅ [01](./01-setup.md)                            | Setup: Maven, Boot 3, Java 21, project layout              | cap. 1             |
| ✅ [02](./02-di-y-beans.md)                       | DI y beans: IoC container, autowiring, scopes              | cap. 2–3           |
| ✅ [03](./03-controllers-y-validation.md)         | Controllers y Bean Validation                              | cap. 5             |
| ✅ [04](./04-spring-data-jpa.md)                  | Spring Data JPA: entidades, repos, transacciones           | cap. 11            |
| ✅ [05](./05-records-y-sealed-classes.md)         | Records y sealed classes para el dominio                   | (no en libro)      |
| ✅ [06](./06-testing.md)                          | Testing: `@SpringBootTest`, MockMvc, Testcontainers        | cap. 14            |
| ✅ [07](./07-error-handling.md)                   | Error handling: `@ControllerAdvice` y `ProblemDetail`      | (no en libro)      |
| ✅ [08](./08-profiles-y-config.md)                | Profiles, config externalizada y validation                | cap. 16            |
| ✅ [09](./09-actuator-micrometer-prometheus.md)   | Actuator, Micrometer y Prometheus                          | (no en libro)      |
| ✅ [10](./10-opentelemetry.md)                    | OpenTelemetry en Spring                                    | (no en libro)      |
| ✅ [11](./11-docker-multistage-y-buildpacks.md)   | Docker multi-stage y Cloud Native Buildpacks               | (no en libro)      |
| ✅ [12](./12-security.md)                         | Security básica con Spring Security 6                      | cap. 9             |
| ✅ [13](./13-async-y-virtual-threads.md)          | Async y virtual threads                                    | (no en libro)      |

Las celdas "(no en libro)" son material moderno que añadimos por necesidad real. Las del libro están parcialmente cubiertas — los conceptos viejos los saltamos.

## Qué NO vas a encontrar aquí

- Spring XML config. No usamos. Si lo encuentras en el libro, es legacy.
- JSPs, Thymeleaf, view layers. Hacemos REST puro.
- Spring Cloud, microservicios, service discovery. Fuera de scope.
- Kotlin. El stack es Java (decidido en la fase de planning).

## Cómo arrancar

```bash
# 1. Tener Java 21 y Maven 3.9+ instalados.
java --version   # → openjdk 21
mvn --version    # → Apache Maven 3.9.x

# 2. Arrancar una Postgres local (cualquier opción válida):
#    a) docker run --name pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 -d postgres:16-alpine
#    b) o el servicio `db` definido en el docker-compose del repo: `make db-up`

# 3. Aplicar el schema. Las migraciones SQL viven en /migrations al raíz del
#    repo. Para aplicarlas, usa el script SQL directamente o el método que
#    prefieras (psql, flyway, etc.):
psql "postgresql://postgres:postgres@localhost:55432/app" -f migrations/0001_initial.sql

# 4. Arrancar la API:
cd services/spring-api
mvn spring-boot:run -Dspring-boot.run.profiles=dev

# 5. Probar:
curl http://localhost:8080/health
curl http://localhost:8080/actuator/health
curl -X POST http://localhost:8080/users \
     -H 'content-type: application/json' \
     -d '{"email":"jose@example.com","name":"Jose"}'
curl http://localhost:8080/users
```

Si todo va bien, recibes un 201 con el user creado y el GET te lista lo que hay en la tabla.

---

**Siguiente:** [01 — Setup: Maven, Boot 3, Java 21, project layout](./01-setup.md)
