# spring-api

Spring Boot 3.x + Java 21 companion to `node-ts-starter`. Same domain (`/users`),
same Postgres, different stack — for side-by-side learning.

## Requirements (local dev)

- **JDK 21** (Temurin recommended). Verify: `java --version`
- **Maven 3.9+**. Verify: `mvn --version`
- **Docker** (only if running tests with Testcontainers, or via docker-compose)

If you prefer not to install Maven globally, generate the Maven Wrapper once:

```bash
cd services/spring-api && mvn -N wrapper:wrapper
```

This produces `mvnw` / `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties`.
Commit them and use `./mvnw` instead of `mvn` from then on.

## Running

```bash
# From the repo root:
make dev-spring-api          # mvn spring-boot:run (port 8080)
make spring-test             # mvn test (uses Testcontainers Postgres)
make spring-package          # mvn -DskipTests package → target/*.jar

# Or directly:
cd services/spring-api
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

## Endpoints

| Method | Path                    | Notes                                  |
|--------|-------------------------|----------------------------------------|
| GET    | /health                 | Plain `{ status, ts }` (mirrors node-api) |
| GET    | /users                  | List all users                         |
| GET    | /users/{id}             | Fetch by id                            |
| POST   | /users                  | Create (body: `{ email, name }`)       |
| GET    | /actuator/health        | Spring Boot health check               |
| GET    | /actuator/prometheus    | Micrometer Prometheus exposition       |

## Schema ownership

Migrations live at the repo root (`/migrations`) and are **owned by node-api**.
Spring-API reads from the same tables but never alters the schema
(`spring.jpa.hibernate.ddl-auto: none`). To apply pending migrations:

```bash
make node-migrate
```

In integration tests, Testcontainers spins up a fresh Postgres and Hibernate
creates the schema (`ddl-auto: create-drop`) since the migrations runner is
not available to the test JVM.

## Docker

The image is built from the repo root (build context is `.`):

```bash
make build-spring-api
make up                  # full prod stack: node-api + spring-api + web
```
