# 10 — OpenTelemetry en Spring

## El problema

El cap. 09 cubre **métricas** (`/actuator/prometheus`) y **logs**. Te dan dos vistas del sistema, pero hay un agujero:

> ¿Por qué este `POST /users` concreto tardó 3 segundos cuando los demás tardan 30ms?

Las métricas te dicen que **algunas** requests son lentas (p99). Los logs te dan eventos sueltos. Ninguno conecta las piezas — no sabes **qué pasos** dentro de esa request específica fueron lentos, ni qué llamadas a la DB o a servicios externos las causaron.

La tercera pieza es **distributed tracing**: una traza es la **secuencia completa de operaciones** que dispara una request, con timestamps en cada paso, propagada incluso si la request salta a otros servicios.

```
trace_id=abc123
├─ HTTP POST /users  (320ms total)
│  ├─ ValidationFilter      (1ms)
│  ├─ UserController.create (315ms)
│  │  ├─ UserService.create (310ms)
│  │  │  ├─ existsByEmail   (5ms)        ← SELECT count(*) FROM users WHERE email = ?
│  │  │  └─ save            (300ms)      ← INSERT (lenta — quizá lock o índice frío)
│  │  └─ ResponseSerialize  (5ms)
```

**OpenTelemetry (OTel)** es el estándar abierto (CNCF) para emitir esto. Vendor-neutral: tu código exporta a OTLP, y el colector lo manda a Tempo / Jaeger / Honeycomb / Datadog / lo que sea, sin tocar tu código. Spring Boot 3 lo integra vía **Micrometer Observation API** + un bridge a OTel.

Este doc cubre cómo cablear OTel en `services/spring-api/` y cómo correlacionar trazas, logs y métricas.

## Las tres señales

OTel define tres signals como modelo unificado:

| Signal      | Qué responde                                      | Lo viste en |
|-------------|---------------------------------------------------|-------------|
| **Metrics** | "¿Cuál es la tasa/latencia/error global?"         | Cap. 09     |
| **Logs**    | "¿Qué pasó en este momento concreto?"             | Cap. 07     |
| **Traces**  | "¿Qué hizo esta request específica, paso a paso?" | Este doc    |

La gracia de OTel es que **las tres comparten el mismo modelo de context**: `traceId`/`spanId`. Si tus logs incluyen `traceId`, puedes saltar de un log a la traza completa con un click en Grafana / Honeycomb. Si una métrica se dispara, puedes filtrar trazas por la ventana de tiempo y ver ejemplos concretos. Esto es **el santo grial de la observabilidad**: las tres señales correlacionadas.

## Conceptos clave

### Trace, Span, Context

- **Trace** — una unidad de trabajo end-to-end. Identificada por `traceId` (32 hex chars).
- **Span** — una operación dentro de una trace. Tiene `spanId`, `parentSpanId`, nombre, timestamps de inicio/fin, atributos (tags), eventos, status.
- **Context** — el handle que se propaga entre threads y servicios para que un span sepa quién es su padre.

Una trace es **un árbol de spans** con un span raíz (el más exterior) y descendientes.

### Auto-instrumentation

Para no anotar todo a mano, OTel y Micrometer **detectan** llamadas a librerías conocidas y crean spans automáticamente:

| Lo que detecta auto                  | Span generado                                |
|--------------------------------------|----------------------------------------------|
| HTTP request entrante (Spring MVC)   | `http.server.request POST /users`            |
| HTTP request saliente (`RestClient`, `WebClient`) | `http.client.request GET https://...`|
| JDBC query                           | `db.query SELECT ... FROM users`             |
| Hibernate session                    | `hibernate.session.flush`                    |
| Kafka producer/consumer              | `kafka.produce topic-name`                   |
| Redis, MongoDB, gRPC, …              | spans por operación                          |

Tú no tocas el código de tu controller — un span aparece igualmente.

### Context propagation

Cuando tu app llama a otro servicio, **propaga el contexto en headers HTTP**:

```
traceparent: 00-abc123abc123abc123abc123abc12300-fedcba9876543210-01
```

Formato W3C Trace Context (estándar). El segundo servicio lo lee, crea spans hijos con el mismo `traceId`, y la trace queda completa cruzando servicios. Spring lo hace automáticamente para `RestClient`/`WebClient` outbound y `RequestMapping` inbound.

## Setup en Spring Boot 3

El repo tiene la **infra** lista (`docker-compose.obs.yml` levanta Tempo + Grafana, las env vars `OTEL_EXPORTER_OTLP_ENDPOINT` ya están en el compose), pero **el bean de tracing en la app no está activo**. Hay que añadir dependencias.

### Opción A — Micrometer Tracing + bridge a OTel (recomendada)

Spring Boot 3 abraza Micrometer como API de observabilidad. El "bridge" envía las observaciones a OTel:

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-otel</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
```

Y en `application.yml`:

```yaml
management:
  tracing:
    sampling:
      probability: 1.0           # 100% de requests (solo en dev)
  otlp:
    tracing:
      endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318}/v1/traces

spring:
  application:
    name: node-ts-starter-spring-api    # se convierte en el service.name de OTel
```

Con esto, cada request HTTP genera un span. Cada query JDBC también (si añades `opentelemetry-jdbc` y configuras el dialect en el JDBC URL). Spring MVC + RestClient + Hibernate están instrumentados.

### Opción B — Java agent (zero-code)

Alternativa: añade un Java agent al arranque:

```bash
java -javaagent:/path/to/opentelemetry-javaagent.jar \
     -Dotel.service.name=node-ts-starter-spring-api \
     -Dotel.exporter.otlp.endpoint=http://localhost:4318 \
     -jar target/*.jar
```

El agent instrumenta vía bytecode rewrite **a runtime**: detecta cientos de librerías (mucho más amplio que Micrometer) e inyecta spans sin que cambies código ni `pom.xml`. Trade-off: más overhead, comportamiento "mágico", y conflictos potenciales si también usas Micrometer Tracing.

> 💡 **Cuándo cada opción**: A para apps Spring puras donde quieres control y código explícito. B cuando tu stack incluye libs raras que Micrometer no cubre (drivers exóticos, RPC propietarios) o tienes muchos servicios polyglot y prefieres operar el agent una vez.

### Sampling

Cada trace pesa (en CPU, red, almacenamiento). En dev, sampling 1.0 (100%). En prod típico: 0.01–0.1 (1–10%):

```yaml
management:
  tracing:
    sampling:
      probability: 0.1
```

Excepciones útiles:

- **Tail sampling**: guardar **todas** las trazas con errores 5xx (decidir al final, no al principio). Requiere un colector más sofisticado (OTel Collector con processor `tailsamplingprocessor`).
- **Parent-based**: hereda la decisión del span padre — si el upstream samplea, este también; si no, no. Spring usa esto por defecto.

## Spans custom

Auto-instrumentation cubre HTTP y JDBC. Para **lógica de negocio** explícita (p. ej. "tiempo total de procesar un import CSV"), declaras spans tú.

### `@Observed` — anotación declarativa

```java
import io.micrometer.observation.annotation.Observed;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    @Observed(name = "users.create", contextualName = "create-user")
    @Transactional
    public User create(CreateUserRequest request) { ... }
}
```

Spring intercepta el método (via AOP), abre un Observation (que se traduce a un span), y al volver lo cierra con el resultado. La anotación necesita `ObservationRegistry` configurado (viene auto con el starter cuando hay `micrometer-tracing-bridge-otel`).

### Programmatic: `Observation.createNotStarted(...)`

Más expresivo cuando necesitas atributos custom o eventos intermedios:

```java
@Service
public class ImportService {

    private final ObservationRegistry registry;

    public ImportService(ObservationRegistry registry) {
        this.registry = registry;
    }

    public ImportResult importUsers(InputStream csv) {
        return Observation.createNotStarted("users.import", registry)
            .lowCardinalityKeyValue("source", "csv")
            .observe(() -> {
                var parsed = parse(csv);
                var saved = persist(parsed);
                return new ImportResult(saved.size());
            });
    }
}
```

`.lowCardinalityKeyValue(...)` añade atributos al span con **valores limitados** (bueno para indexing). `.highCardinalityKeyValue(...)` para valores no limitados (request IDs, user IDs — útil en traces pero no en métricas).

### Anidación

Spans dentro de spans crean **árboles**:

```java
public void process(List<Order> orders) {
    Observation.start("orders.batch", registry)
        .observe(() -> {
            for (var order : orders) {
                Observation.createNotStarted("orders.process", registry)
                    .lowCardinalityKeyValue("type", order.type().name())
                    .observe(() -> processOne(order));
            }
        });
}
```

En Tempo/Jaeger verás `orders.batch` como padre y N `orders.process` como hijos, cada uno con su duración y tipo.

## Correlación logs ↔ traces

Para que un log diga "yo soy parte de la trace X span Y", inyectamos los IDs en el **MDC** (Mapped Diagnostic Context) de SLF4J. Spring Boot lo hace automáticamente cuando tracing está activo. En logs Logback verás:

```
2026-05-20T14:32:01.823 INFO  [node-ts-starter-spring-api,abc123...,fedcba...] c.j.api.users.UserService — Creating user jose@example.com
```

El segmento `[appName,traceId,spanId]` se añade vía el pattern por defecto:

```yaml
logging:
  pattern:
    level: "%5p [${spring.application.name:},%X{traceId:-},%X{spanId:-}]"
```

En Grafana puedes:
1. Buscar logs con `traceId=abc123`.
2. Hacer click en el `traceId` para saltar a Tempo y ver la trace completa.
3. Desde un span en Tempo, click para ver los logs asociados.

Esto es lo que distingue una observabilidad **mediocre** (tres dashboards desconectados) de una **buena** (un click te lleva del síntoma al detalle).

### Formato JSON estructurado

Para producción, los logs como JSON estructurado (uno por línea, NDJSON) son **mejor** que texto plano — los aggregators (Loki, ELK, Datadog) los parsean nativamente. Añade `logstash-logback-encoder` al `pom.xml` y configura:

```xml
<!-- logback-spring.xml -->
<appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <includeMdcKeyName>traceId</includeMdcKeyName>
        <includeMdcKeyName>spanId</includeMdcKeyName>
    </encoder>
</appender>
```

Los logs JSON ya incluyen `traceId`/`spanId` como campos, fácil de filtrar.

## Exporters

OTel separa **dónde** mandas los datos del **cómo** los generas. Tres exporters principales:

- **OTLP** (OpenTelemetry Protocol) — el estándar moderno. Soporta gRPC y HTTP. Lo aceptan Tempo, Jaeger 1.35+, Honeycomb, Datadog, New Relic, …
- **Jaeger thrift** — el formato nativo de Jaeger. Legacy, sigue funcionando.
- **Zipkin JSON** — el formato de Zipkin. También legacy.

**Usa OTLP siempre que puedas.** Vendor lock-in mínimo, cambias el endpoint y exportas a otro backend.

### OTel Collector (preview, cap. 11)

Para producción seria querrás un **OTel Collector** intermedio: tus apps exportan a una instancia local del collector (sidecar o DaemonSet), y el collector procesa (batch, retry, sample, attribute drop) y reexporta al backend final. Beneficios: las apps no necesitan saber a qué backend van, y puedes cambiar de Tempo a Honeycomb sin tocar código.

## Stack del repo

El `docker-compose.obs.yml` levanta:

- **Tempo** (`:3200`) — almacena trazas, expone OTLP HTTP en `:4318` y gRPC en `:4317`.
- **Prometheus** (`:9090`) — métricas (ya cubierto en cap. 09).
- **Grafana** (`:3001`) — UI unificado, lee de Tempo y Prometheus.

Las env vars en el compose ya pasan `OTEL_EXPORTER_OTLP_ENDPOINT` a la app. Cuando añadas las deps de Micrometer Tracing + OTel exporter al `pom.xml`, las trazas empezarán a fluir a Tempo y aparecerán en Grafana sin más config.

```bash
make obs-up
# Levanta: db + node-api + spring-api + web + prometheus + tempo + grafana
# Abre Grafana en http://localhost:3001 → datasource Tempo → query traces
```

## Trampas comunes

1. **Sampling probability 1.0 en producción**: explosivo en CPU, red y almacenamiento. Tempo/Jaeger con 1000 req/s y traces de 50 spans = 50000 spans/s = decenas de GB/día. Empieza en `0.01` (1%) y sube si necesitas más resolución.

2. **`service.name` no configurado**: si no pones `spring.application.name` o `OTEL_SERVICE_NAME`, todas tus apps aparecen como `"unknown_service"` en Grafana/Tempo. Confunde para distinguir servicios. **Siempre** setea el nombre.

3. **Java agent + Micrometer Tracing al mismo tiempo**: las dos cosas instrumentan los mismos métodos y generan **spans duplicados**. Elige una: agent (zero-code) **o** Micrometer (in-code). No las dos.

4. **Spans sin terminar** (manual): si llamas `Observation.start(...)` y no `.stop()` (o no usas `.observe(() -> ...)`), el span queda **abierto en memoria**. Memory leak. Usa **siempre** el patrón `.observe(() -> ...)` que cierra solo.

5. **Context propagation roto en threads custom**:
   ```java
   executor.submit(() -> heavyWork());   // ❌ pierde el trace context
   ```
   Spring tiene un `ContextSnapshotFactory` y Micrometer Context Propagation library para envolver Runnables/Callables. O usa `@Async` que respeta el context si configuras el `TaskExecutor` correctamente.

6. **Atributos sensibles en spans**: no metas passwords, tokens, PII en `.lowCardinalityKeyValue`. Quedan persistidos en Tempo y son visibles a cualquiera con acceso a Grafana. Sanitiza antes.

7. **High cardinality en tags de span**: igual que en métricas (cap. 09). Tags con valores ilimitados (`user_id`, `request_id`) están **bien** en spans (alto valor para debug) pero **mal** en métricas derivadas de spans. Si Tempo deriva métricas de tus spans (`spanmetrics`), asegúrate de que los tags low-cardinality van por separado.

8. **`@Observed` sin AOP activo**: la anotación no hace nada si Spring no puede interceptar el método. Falla silenciosamente — el span no aparece. Verifica que el bean se construye via Spring (no `new`) y que `spring-boot-starter-aop` está en el classpath (viene con web).

9. **Logs sin `traceId` aunque OTel está activo**: si tu pattern de logging no incluye `%X{traceId}`, los logs no muestran el id aunque esté en el MDC. Verifica `logging.pattern.level`.

10. **OTLP endpoint mal formado**: el path correcto para HTTP es `http://collector:4318/v1/traces` (con sufijo `/v1/traces` para traces, `/v1/metrics` para metrics, `/v1/logs` para logs). Si solo pones `http://collector:4318`, depende del cliente — algunos añaden el path, otros no.

## Ejercicio

1. **Añade el cableado OTel**:
   - Añade `micrometer-tracing-bridge-otel` y `opentelemetry-exporter-otlp` al `pom.xml`.
   - Configura en `application.yml`:
     ```yaml
     management:
       tracing:
         sampling:
           probability: 1.0
       otlp:
         tracing:
           endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318}/v1/traces
     ```
   - Arranca `make obs-up`. Haz 5 requests al `POST /users`. Abre Grafana (`:3001`), datasource Tempo, busca las traces de tu service.

2. **Span custom con `@Observed`**: anota `UserService.create` con `@Observed(name = "users.create")`. Verifica en Tempo que ahora ves un span `users.create` como hijo del span HTTP raíz. Mide su duración.

3. **Atributos al span**: refactoriza `UserService.create` para usar `Observation.createNotStarted(...)` programáticamente y añadir `.lowCardinalityKeyValue("validation.passed", "true")` y `.highCardinalityKeyValue("user.email.domain", emailDomain)`. Verifica en Tempo que los atributos aparecen.

4. **Correlación log ↔ trace**: ajusta `logging.pattern.level` para incluir `traceId`/`spanId`. Haz un POST a `/users` con un email inválido. En los logs verás el ProblemDetail con un `traceId`. Pega ese `traceId` en Tempo — debes ver la traza completa.

5. **Sampling**: cambia `probability: 1.0` a `0.1`. Haz 100 requests al `/health` con un loop. Cuenta cuántas traces aparecen en Tempo. ¿Cerca de 10? El sampling de OTel no es exacto pero es estadísticamente cercano.

6. **Cross-service trace**: añade un endpoint `GET /external` que use `RestClient` para llamar al `node-api` en `:3000/health`. Cuando hagas una request al spring-api, debería aparecer una traza con dos spans: el HTTP entrante en spring-api y el HTTP saliente al node-api. ¿Aparecen anidados?

7. **Reto — error en la traza**: provoca una excepción dentro de un método anotado con `@Observed`. En Tempo, verifica que el span aparece con `status: ERROR` y la excepción como evento del span. ¿Cómo lo verías si el span no fuera tuyo (auto-instrumentado)?

## 📖 Lectura paralela

> ⚠️ Esto **no está en el libro** (4ª ed., 2014). OpenTelemetry es un standard de 2019 (merge de OpenCensus + OpenTracing). La integración Spring Boot oficial vía Micrometer Tracing es de Boot 3.0 (2022). Todo lo siguiente es post-libro.

### Documentación oficial

- [Spring Boot Reference — Observability](https://docs.spring.io/spring-boot/reference/actuator/observability.html) — chapter dedicado a metrics + traces.
- [Spring Boot Reference — Tracing](https://docs.spring.io/spring-boot/reference/actuator/tracing.html) — config de tracing y exporters.
- [Micrometer Observation API](https://docs.micrometer.io/micrometer/reference/observation.html) — la API que está detrás de `@Observed` y `Observation.start(...)`.
- [OpenTelemetry — Java Documentation](https://opentelemetry.io/docs/languages/java/) — referencia general.
- [OpenTelemetry — Auto-instrumentation list](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/supported-libraries.md) — qué cubre el Java agent sin código.

### Estándares

- [W3C Trace Context](https://www.w3.org/TR/trace-context/) — el formato `traceparent`. Spec corta, ~15 min.
- [W3C Baggage](https://www.w3.org/TR/baggage/) — el sidecar para propagar metadata user-defined entre servicios.

### Artículos / charlas

- [Spring Tips — Observability](https://spring.io/blog/2022/10/12/observability-with-spring-boot-3) — la intro oficial de Micrometer Tracing + OTel cuando salió en Boot 3.
- [Honeycomb — What Is Observability?](https://www.honeycomb.io/blog/what-is-observability) — el por qué de las 3 señales y las traces específicamente.
- [Cindy Sridharan — Distributed Systems Observability (libro gratuito)](https://www.oreilly.com/library/view/distributed-systems-observability/9781492033431/) — el manual moderno de observabilidad. Independiente de tecnología.

---

**Anterior:** [09 — Actuator, Micrometer y Prometheus](./09-actuator-micrometer-prometheus.md)
**Siguiente:** [11 — Docker multi-stage y Cloud Native Buildpacks](./11-docker-multistage-y-buildpacks.md)
