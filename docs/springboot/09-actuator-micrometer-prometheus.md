# 09 — Actuator, Micrometer y Prometheus

## El problema

Una API en producción debe ser **observable**: poder responder a "¿está viva?", "¿qué versión está corriendo?", "¿cuántas requests/s aguanta?", "¿qué está consumiendo memoria?" — **sin** SSH-ear al servidor ni leer logs a ojo. Esto se llama operabilidad y abarca tres capas:

1. **Health checks** — endpoints que reportan si el sistema está bien y sus dependencias también. Los usan load balancers, k8s probes, dashboards de status.
2. **Métricas** — números agregables en el tiempo (requests/s, latencia p99, errores, conexiones DB). Los consume Prometheus, Datadog, CloudWatch.
3. **Info & runtime control** — versión del build, config activa, cambiar log levels al vuelo, heap dumps bajo demanda.

Spring Boot lo resuelve con **Actuator** (los endpoints) + **Micrometer** (la API de métricas vendor-neutral) + un registry concreto (Prometheus, Datadog, Influx…). El repo ya tiene el cableado completo:

- `spring-boot-starter-actuator` en `pom.xml`.
- `micrometer-registry-prometheus` (runtime).
- `management.endpoints.web.exposure.include: health,info,prometheus` en `application.yml`.
- `observability/prometheus.yml` scrapea `/actuator/prometheus` cada 5s.

Este doc explica qué hay debajo y cómo añadir tus propias métricas, health indicators y info contributors.

## Spring Boot Actuator

Una vez incluido el starter, Spring registra un set de endpoints bajo `/actuator/*`. Por defecto **solo `/actuator/health` está expuesto vía HTTP** — el resto requiere activarlos. La razón es de seguridad: muchos exponen información sensible.

### Endpoints clave

| Endpoint                  | Qué da                                                       |
|---------------------------|--------------------------------------------------------------|
| `/actuator/health`        | UP/DOWN + health de dependencias                             |
| `/actuator/info`          | Build/git info + datos custom                                |
| `/actuator/metrics`       | Listado de metrics + valor actual (vista humana)             |
| `/actuator/prometheus`    | Métricas en formato Prometheus text                          |
| `/actuator/env`           | Todas las properties resueltas (peligroso — filtra secrets) |
| `/actuator/beans`         | El grafo de beans en el contexto                             |
| `/actuator/mappings`      | Todas las rutas HTTP registradas                             |
| `/actuator/loggers`       | Listar y **modificar** log levels en runtime                 |
| `/actuator/threaddump`    | Stack trace de todos los threads (debug deadlocks)           |
| `/actuator/heapdump`      | Descarga el heap (.hprof) para análisis offline              |
| `/actuator/conditions`    | Por qué cada auto-config se aplicó o no                      |
| `/actuator/configprops`   | `@ConfigurationProperties` resueltos                         |
| `/actuator/shutdown`      | **Mata el proceso** (desactivado por defecto)                |

### Configuración de exposure

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus     # opt-in explícito
        exclude: env,beans                  # excluir explícitamente
      base-path: /actuator                  # prefijo (default)
  endpoint:
    health:
      show-details: when_authorized          # never | always | when_authorized
      probes:
        enabled: true                       # añade /health/liveness y /readiness
    shutdown:
      enabled: false                        # mantener apagado
```

> 💡 **Regla de oro en prod**: expón **solo** `health,info,prometheus` por HTTP. Lo demás cae bajo el principle of least privilege — si necesitas `/actuator/env` o `/actuator/loggers`, exponlos en un **port separado** (`management.server.port`) bindeado a una red privada, o detrás de auth.

### Puerto separado para Actuator

Para aislar Actuator del tráfico de cliente:

```yaml
management:
  server:
    port: 8081               # actuator en :8081
    address: 127.0.0.1       # solo localhost
```

Patrón típico en k8s: `:8080` expuesto al ingress, `:8081` solo accesible desde el cluster (Prometheus, kubelet probes).

## `/actuator/health` a fondo

```bash
curl http://localhost:8080/actuator/health
```

Con `show-details: never` (el default seguro):

```json
{ "status": "UP" }
```

Con `show-details: always` (o `when_authorized` + auth pasada):

```json
{
  "status": "UP",
  "components": {
    "db": { "status": "UP", "details": { "database": "PostgreSQL", "validationQuery": "isValid()" } },
    "diskSpace": { "status": "UP", "details": { "total": 250GB, "free": 100GB, "threshold": 10MB } },
    "ping": { "status": "UP" },
    "livenessState": { "status": "UP" },
    "readinessState": { "status": "UP" }
  }
}
```

### Health indicators built-in

Spring detecta qué hay en el classpath y registra indicators automáticamente:

| Starter / lib                | Indicator                                           |
|------------------------------|-----------------------------------------------------|
| `spring-boot-starter-data-jpa` | `db` — `SELECT 1` o `isValid()` contra DataSource |
| `spring-boot-starter-data-redis` | `redis` — PING                                   |
| `spring-boot-starter-mail`   | `mail` — conecta al SMTP                            |
| Disk presente                | `diskSpace` — espacio libre vs threshold            |
| `spring-boot-starter-amqp`   | `rabbit` — health del broker                        |

Si tu Postgres se cae, `/actuator/health` devuelve `503 Service Unavailable` y `status: DOWN`. El load balancer lo detecta y deja de mandar tráfico.

### Custom `HealthIndicator`

Para health checks de **lógica de negocio** (un servicio externo crítico, una cola con depth máximo, etc.):

```java
package com.josemoro.api.health;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component
public class ExternalApiHealthIndicator implements HealthIndicator {

    private final ExternalApiClient client;

    public ExternalApiHealthIndicator(ExternalApiClient client) {
        this.client = client;
    }

    @Override
    public Health health() {
        try {
            var latencyMs = client.ping();
            if (latencyMs > 500) {
                return Health.outOfService()
                    .withDetail("latencyMs", latencyMs)
                    .withDetail("threshold", 500)
                    .build();
            }
            return Health.up().withDetail("latencyMs", latencyMs).build();
        } catch (Exception ex) {
            return Health.down(ex).build();
        }
    }
}
```

El bean se llama `externalApi` (Spring le quita el suffix `HealthIndicator`) y aparece en `/actuator/health/components/externalApi`.

### Liveness y readiness probes

Para Kubernetes (o cualquier orquestador moderno):

- **Liveness** — "¿el proceso está vivo o atascado?" Si DOWN → k8s reinicia el pod.
- **Readiness** — "¿está listo para recibir tráfico?" Si DOWN → k8s lo saca del Service. Útil durante startup (warming up cache, conectando a DB) o degradación (DB lenta).

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
```

Y endpoints separados:

```
GET /actuator/health/liveness
GET /actuator/health/readiness
```

```yaml
# k8s pod spec
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  initialDelaySeconds: 30
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  initialDelaySeconds: 5
```

### Groups

Para agregar selectivamente health indicators bajo un nombre:

```yaml
management:
  endpoint:
    health:
      group:
        custom-critical:
          include: db, externalApi
          show-details: always
```

Y `GET /actuator/health/custom-critical` devuelve solo esos dos.

## `/actuator/info`

Por defecto vacío. Se llena con:

### Build info — vía `spring-boot-maven-plugin`

Añade al `pom.xml`:

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <executions>
        <execution>
            <goals><goal>build-info</goal></goals>
        </execution>
    </executions>
</plugin>
```

Esto genera `META-INF/build-info.properties` con `build.version`, `build.time`, `build.artifact`. Spring lo expone:

```json
{ "build": { "artifact": "node-ts-starter-spring-api", "version": "0.1.0", "time": "2026-05-20T..." } }
```

### Git info — vía `git-commit-id-maven-plugin`

```xml
<plugin>
    <groupId>io.github.git-commit-id</groupId>
    <artifactId>git-commit-id-maven-plugin</artifactId>
</plugin>
```

Genera `git.properties` con commit SHA, branch, tag, dirty flag. Expuesto bajo `info.git`. Útil para debug ("¿qué versión estoy mirando?").

### Custom `InfoContributor`

Para info de runtime (config activa, feature flags, dependencias):

```java
@Component
public class FeatureFlagsInfoContributor implements InfoContributor {

    private final FeatureFlagService flags;

    public FeatureFlagsInfoContributor(FeatureFlagService flags) {
        this.flags = flags;
    }

    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("features", flags.activeFlagsSummary());
    }
}
```

## Micrometer — la API de métricas

Micrometer es la **fachada** que Spring usa para métricas. Tu código siempre habla con Micrometer; Micrometer envía a Prometheus (o Datadog, Influx, lo que sea). Cambiar el backend = cambiar la dependencia, no el código.

### Tipos de meters

| Meter                  | Para qué                                       | Ejemplo                                    |
|------------------------|------------------------------------------------|--------------------------------------------|
| **Counter**            | Contar eventos (siempre sube)                  | `users.created.total`                     |
| **Gauge**              | Valor que sube y baja                          | `queue.size`, `cache.hits.ratio`           |
| **Timer**              | Duración + frecuencia de operaciones           | `http.server.requests`, `db.query.duration`|
| **DistributionSummary**| Valores arbitrarios (no necesariamente tiempo) | `request.body.size`                        |
| **LongTaskTimer**      | Operaciones largas en curso (sin completar)    | `batch.import.running`                     |

### Métricas built-in

Sin escribir nada, Boot expone:

- **`http.server.requests`** — Timer por endpoint, status, exception. La métrica fundamental para latencia/throughput de tu API.
- **`jvm.memory.*`** — heap, non-heap, used/committed/max.
- **`jvm.gc.*`** — pauses, count.
- **`jvm.threads.*`** — count, states.
- **`system.cpu.usage`, `process.cpu.usage`** — CPU.
- **`tomcat.sessions.*`** — sesiones del embedded Tomcat.
- **`hikaricp.*`** — pool de conexiones.
- **`hibernate.*`** (si activas `spring.jpa.properties.hibernate.generate_statistics=true`).
- **`logback.events`** — counter por log level.

### Tags (dimensiones)

Cada metric tiene **tags** que la dividen en series:

```
http.server.requests{method=GET,uri=/users,status=200,exception=None}
http.server.requests{method=POST,uri=/users,status=201,exception=None}
http.server.requests{method=POST,uri=/users,status=409,exception=EmailAlreadyTaken}
```

Prometheus las indexa y permite consultas como "p95 latencia de POSTs a /users que fallan":

```promql
histogram_quantile(0.95,
  rate(http_server_requests_seconds_bucket{method="POST",uri="/users",status!~"2.."}[5m])
)
```

## Métricas custom

### Inyecta `MeterRegistry`

```java
@Service
public class UserService {

    private final UserRepository repository;
    private final Counter usersCreated;
    private final Timer userCreationDuration;

    public UserService(UserRepository repository, MeterRegistry registry) {
        this.repository = repository;
        this.usersCreated = Counter.builder("users.created.total")
            .description("Total users created")
            .tag("source", "api")
            .register(registry);
        this.userCreationDuration = Timer.builder("users.creation.duration")
            .description("Time to create a user")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
    }

    @Transactional
    public User create(CreateUserRequest request) {
        return userCreationDuration.record(() -> {
            var user = new User(UUID.randomUUID().toString(), request.email(), request.name());
            var saved = repository.save(user);
            usersCreated.increment();
            return saved;
        });
    }
}
```

Después de unas requests, en `/actuator/prometheus`:

```
# HELP users_created_total Total users created
# TYPE users_created_total counter
users_created_total{source="api"} 42.0

# HELP users_creation_duration_seconds Time to create a user
# TYPE users_creation_duration_seconds summary
users_creation_duration_seconds{quantile="0.5"} 0.005
users_creation_duration_seconds{quantile="0.95"} 0.020
users_creation_duration_seconds{quantile="0.99"} 0.080
users_creation_duration_seconds_count 42.0
users_creation_duration_seconds_sum 0.234
```

### `@Timed` para instrumentación declarativa

Para métodos donde quieres un Timer sin escribir el wiring:

```java
@Service
public class ReportService {

    @Timed(value = "reports.generation", description = "Time to generate a report",
           percentiles = { 0.5, 0.95, 0.99 })
    public Report generate(ReportParams params) { ... }
}
```

`@Timed` requiere **AOP activo** (viene con el starter web). Pon la anotación, el bean se intercepta automáticamente.

### Gauges para valores que fluctúan

```java
@Component
public class QueueMetrics {

    public QueueMetrics(MeterRegistry registry, JobQueue queue) {
        Gauge.builder("job.queue.size", queue, JobQueue::size)
            .description("Current job queue depth")
            .register(registry);
    }
}
```

Micrometer llama a `queue.size()` cada vez que Prometheus scrapea. **El gauge no almacena el valor** — la fuente de verdad es `queue`.

## El endpoint `/actuator/prometheus`

```bash
curl http://localhost:8080/actuator/prometheus
```

Devuelve **text/plain** en el formato Prometheus exposition:

```
# HELP http_server_requests_seconds Duration of HTTP server requests
# TYPE http_server_requests_seconds summary
http_server_requests_seconds_count{exception="None",method="GET",outcome="SUCCESS",status="200",uri="/health"} 142.0
http_server_requests_seconds_sum{...} 0.78

# HELP jvm_memory_used_bytes The amount of used memory
# TYPE jvm_memory_used_bytes gauge
jvm_memory_used_bytes{area="heap",id="G1 Eden Space"} 4.194304E7
```

Prometheus scrapea esto cada 5–30s (configurable) y persiste los puntos. Después haces queries con PromQL.

### Config Prometheus (referencia)

En `observability/prometheus.yml` del repo:

```yaml
scrape_configs:
  - job_name: spring-api
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ['spring-api:8080']
        labels:
          service: node-ts-starter-spring-api
```

Levanta el stack con `make obs-up` y abre Grafana en `:3001` para visualizar.

## `/actuator/loggers` — cambiar log level al vuelo

Sin reiniciar el proceso:

```bash
# Ver el level actual:
curl http://localhost:8080/actuator/loggers/com.josemoro.api

# Cambiarlo a DEBUG:
curl -X POST http://localhost:8080/actuator/loggers/com.josemoro.api \
  -H 'Content-Type: application/json' \
  -d '{"configuredLevel": "DEBUG"}'

# Restablecer a default:
curl -X POST http://localhost:8080/actuator/loggers/com.josemoro.api \
  -H 'Content-Type: application/json' \
  -d '{"configuredLevel": null}'
```

Muy útil para debug en producción puntual. **Asegúrate de protegerlo con auth** — cualquiera con acceso puede activar TRACE y llenar logs / disco.

## Trampas comunes

1. **Exponer todo en prod con `include: '*'`**: filtras secrets vía `/actuator/env`, abres `/actuator/heapdump` (cualquiera puede dump tu heap), expones internals con `/actuator/beans`. **Solo `health,info,prometheus`** por HTTP en producción.

2. **High-cardinality tags**: una métrica con un tag tipo `user_id` o `request_id` explota Prometheus — cada user crea una serie nueva. Reglas:
   - **Tags estables**: status code, method, uri (con plantilla), exception class.
   - **NO** tags variables sin límite: IDs de usuario, UUIDs, query strings.
   Si tu Prometheus consume 10GB de RAM al día, casi siempre es por high cardinality.

3. **Sin `management.endpoint.health.show-details`**: el default `never` está bien para prod. Si necesitas detalles, pon `when_authorized` + autenticación. **Never** uses `always` en producción pública.

4. **`/actuator/shutdown` accidentalmente expuesto**: `shutdown.enabled: true` + exposure include incluye `shutdown` = un POST mata tu API. Deja `enabled: false` o exponlo solo en un puerto interno.

5. **No diferenciar liveness y readiness**: si solo configuras un health check, k8s puede reiniciar pods que solo están temporalmente sin recibir tráfico (graceful shutdown, DB warmup). Usa los dos.

6. **`@Timed` sin AOP**: si quitas `spring-boot-starter-aop` o pones la anotación en una clase no-bean (instanciada con `new`), no se intercepta. Síntoma: la métrica no aparece. Verifica que la clase es un `@Service`/`@Component` y que está siendo inyectada (no `new`).

7. **`Counter`/`Timer` creados dentro del método de business**:
   ```java
   public User create(...) {
       Counter c = Counter.builder("users.created").register(registry);   // ❌
       c.increment();
   }
   ```
   Creas (y registras) el counter en cada llamada. Micrometer lo deduplica pero hace trabajo innecesario y obscure el bean lifecycle. **Crea los meters una vez** en el constructor.

8. **`/actuator/info` vacío al añadir el plugin**: el `build-info` se genera al hacer `mvn package`, no al `mvn spring-boot:run` desde el IDE. Verifica que `target/classes/META-INF/build-info.properties` existe; si no, ejecuta `mvn compile spring-boot:build-info` antes.

9. **Confundir health endpoint con `/health` custom**: el repo tiene un `/health` propio en `HealthController.java`. Spring también expone `/actuator/health`. **Son endpoints distintos** con shapes distintos. El custom es free-form; el de Actuator sigue su protocolo (con groups, indicators, etc.).

10. **Reset de métricas al reload de profile**: si reinicias el ApplicationContext (típico en tests con `@DirtiesContext`), el `MeterRegistry` se reconstruye y las métricas se pierden. Para Prometheus es transparente (scrapea desde cero), pero confunde si lo ves en `/actuator/metrics`.

## Ejercicio

1. **Activa `build-info` y `git-info`**: añade los dos plugins al `pom.xml`. Tras un `mvn package`, verifica `curl http://localhost:8080/actuator/info` y compruebar que tienes `build.version` y `git.commit.id`.

2. **`Counter` y `Timer` en `UserService.create`**: copia el ejemplo del doc. Crea 5 users con curl. Verifica en `/actuator/prometheus` que aparecen `users_created_total{source="api"} 5.0` y `users_creation_duration_seconds_*`.

3. **`@Timed` en un método**: anota `UserService.list()` con `@Timed("users.list.duration")`. Verifica que aparece la métrica tras hacer GETs.

4. **`HealthIndicator` custom**: implementa uno que verifique algo simple del dominio — por ejemplo, que la tabla `users` no esté vacía (`SELECT 1 FROM users LIMIT 1`) y devuelva `OUT_OF_SERVICE` si lo está. Verifica `/actuator/health` con `show-details: always` durante dev.

5. **`Gauge` para conteo en vivo**: registra un gauge sobre `repository.count()` que reporte el total de users. Cuidado con que la query no sea costosa — un `COUNT(*)` en una tabla grande puede serlo.

6. **Loggers en vivo**: con la app corriendo, cambia el log level de `com.josemoro.api` a `DEBUG` via curl al endpoint de loggers. Haz un request. Confirma que ahora aparecen logs DEBUG. Vuélvelo a default.

7. **Reto — Prometheus + Grafana visual**: arranca el stack de observability (`make obs-up` o equivalente). En Grafana (puerto 3001), crea un panel que muestre la latencia p95 de `POST /users` en los últimos 5 minutos. Pista: `histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{method="POST",uri="/users"}[5m])))`.

## 📖 Lectura paralela

> ⚠️ Esto **no está en el libro** (4ª ed., 2014). Spring Boot Actuator existe desde Boot 1.x pero ha cambiado significativamente; el sistema de endpoints actual es de Boot 2.0 (2018). Micrometer se integró en Boot 2.0 reemplazando el sistema viejo basado en Dropwizard Metrics. Todo lo siguiente es post-libro.

### Documentación oficial

- [Spring Boot Reference — Actuator](https://docs.spring.io/spring-boot/reference/actuator/index.html) — referencia canónica completa.
- [Spring Boot Reference — Endpoints](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html) — listado y configuración de cada uno.
- [Spring Boot Reference — Metrics](https://docs.spring.io/spring-boot/reference/actuator/metrics.html) — Micrometer en Boot, métricas built-in.
- [Micrometer Documentation](https://docs.micrometer.io/micrometer/reference/) — la API completa.
- [Prometheus — Best practices](https://prometheus.io/docs/practices/) — naming, labels, histograms vs summaries.

### Artículos / charlas

- [Spring Tips — Micrometer](https://spring.io/blog/2018/03/16/micrometer-spring-boot-2-s-new-application-metrics-collector) — la intro oficial cuando Micrometer reemplazó a Dropwizard.
- [Tomasz Nurkiewicz — Spring Boot Actuator Demystified](https://www.nurkiewicz.com/2018/09/spring-boot-actuator-demystified.html) — overview práctico de cada endpoint.
- [Brian Brazil — Prometheus Up & Running](https://www.oreilly.com/library/view/prometheus-up/9781492034131/) — libro de referencia para entender Prometheus (no Spring-specific).

---

**Anterior:** [08 — Profiles, config externalizada y validation](./08-profiles-y-config.md)
**Siguiente:** [10 — OpenTelemetry en Spring](./10-opentelemetry.md)
