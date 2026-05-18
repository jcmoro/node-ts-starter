# 17 — Stack de observabilidad local (Prometheus + Tempo + Grafana)

## El problema

Llegados al cap. 16, nuestra api **emite** las tres señales:

- Logs estructurados (cap. 12) — pino a stdout
- Métricas (cap. 15) — `/metrics` en formato Prometheus
- Traces (cap. 16) — OTLP via `--import ./src/tracing.ts`

Pero **no las visualizamos**. El `ConsoleSpanExporter` en stdout es bonito para verificar que funciona, no para investigar. Las métricas son texto plano. Los logs son JSON.

Necesitamos las **UIs** que cierren el ciclo: dashboards de métricas, waterfalls de traces, correlación entre los tres. Un stack ligero local que sea **el equivalente fiel** del setup de producción, sin coste cloud.

## El stack

```
                       ┌──────────┐
   POST /users     ┌──▶│ api:3000 │
   GET  /metrics ──┴──▶│          │
                       └────┬─────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        OTLP HTTP      /metrics (pull)    │
        :4318          (every 5s)         │
              │             │             │
              ▼             ▼             │
       ┌────────────┐ ┌──────────────┐    │
       │  Tempo     │ │  Prometheus  │    │
       │  :3200     │ │  :9090       │    │
       └─────┬──────┘ └──────┬───────┘    │
             │               │            │
             └───────┬───────┘            │
                     │                    │
                     ▼                    │
             ┌──────────────┐             │
             │   Grafana    │ ◀───────────┘
             │   :3001      │  (user opens dashboards in browser)
             └──────────────┘
```

Cuatro decisiones senior justificadas:

| Componente | Versión | Por qué |
|------------|---------|---------|
| **Prometheus** | 3.0+ | Standard de facto para metrics. Push-free; scrape pull-based. |
| **Tempo** | 2.6+ (Grafana Labs) | Backend de tracing lightweight, sin Elasticsearch ni Cassandra. Habla OTLP nativo. |
| **Grafana** | 11.4+ | UI unificada para todos los datasources. Provisioning declarativo. |
| **OTel Collector** | — | **Skipped** para minimal. Lo hacemos opt-in (ejercicio). Senior real lo tiene. |

**Alternativas que descartamos**:

- **Jaeger** (en lugar de Tempo): más simple para empezar (UI built-in, all-in-one image), pero rompe el "una sola UI". Para producción seria Tempo + Grafana gana.
- **VictoriaMetrics** (en lugar de Prometheus): más eficiente en disco, drop-in replacement. Si tu Prometheus duele, el siguiente paso.
- **Datadog/Honeycomb/Lightstep/Grafana Cloud**: managed. Para producción real, lo más recomendable. Pero offline local + zero coste es Prometheus + Tempo + Grafana.

## Archivos del stack

```
observability/
├── prometheus.yml              ← scrape config (api:3000/metrics)
├── tempo.yaml                  ← OTLP receivers + storage local
└── grafana-datasources.yaml    ← Prometheus + Tempo datasources auto-provisionados
docker-compose.obs.yml          ← servicios prometheus, tempo, grafana
```

### `observability/prometheus.yml`

```yaml
global:
  scrape_interval: 5s
  scrape_timeout: 3s
  external_labels:
    env: dev
    cluster: local

scrape_configs:
  - job_name: api
    metrics_path: /metrics
    static_configs:
      - targets: ['api:3000']
        labels:
          service: node-ts-starter-api

  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
```

Detalles:

- **`scrape_interval: 5s`** — agresivo para dev (production: 15-60s típicos). Te da gráficas en vivo.
- **`external_labels`** — etiquetas que Prometheus añade a cada serie al federar/exportar. Útiles para distinguir dev/staging/prod en setups multi-cluster.
- **Job `prometheus`** — Prometheus se monitoriza a sí mismo. Verás sus propios RED metrics. Senior baseline.

### `observability/tempo.yaml`

```yaml
server:
  http_listen_port: 3200
  log_level: warn

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318

ingester:
  trace_idle_period: 10s
  max_block_duration: 5m

compactor:
  compaction:
    block_retention: 1h

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/blocks
    wal:
      path: /var/tempo/wal

overrides:
  defaults:
    metrics_generator:
      processors: [service-graphs, span-metrics]
```

Tres detalles que pagan:

- **`distributor.receivers.otlp`** — Tempo expone OTLP HTTP en :4318 y gRPC en :4317. La api del cap. 16 envía traces aquí cuando `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318`.
- **`block_retention: 1h`** — borra traces más viejos de 1h. En prod: 24-72h típicos. En dev: 1h ahorra disco y rota rápido.
- **`metrics_generator: [service-graphs, span-metrics]`** — esto es **la pieza de oro**. Tempo deriva métricas **automáticamente desde los traces**: `traces_service_graph_request_total`, `traces_spanmetrics_calls_total`, `traces_spanmetrics_duration_seconds_bucket`. Sin escribir una línea, Grafana tiene un panel "Service Graph" funcional.

### `observability/grafana-datasources.yaml`

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      timeInterval: 5s
      exemplarTraceIdDestinations:
        - name: traceId
          datasourceUid: tempo

  - name: Tempo
    type: tempo
    uid: tempo
    url: http://tempo:3200
    jsonData:
      tracesToMetrics:
        datasourceUid: prometheus
      serviceMap:
        datasourceUid: prometheus
      nodeGraph:
        enabled: true
```

Tres conexiones cruzadas críticas:

1. **`exemplarTraceIdDestinations`** — cuando Prometheus expone exemplars (samples con `traceId` adjunto a un bucket de histogram), Grafana muestra puntitos en los gráficos. Clic → te abre el trace en Tempo. **Esto es la magia logs↔metrics↔traces**.
2. **`tracesToMetrics`** — desde un span en Tempo, "Show me the metrics for this time range" abre Prometheus.
3. **`serviceMap`** — el panel de service graph (qué servicio llama a qué) usa span metrics que Tempo genera.

> 💡 **No auto-provisionamos dashboards**. Razón senior: Grafana JSON es brittle, los dashboards-as-code son un tema entero (Grafonnet, Terraform), y aprender a construir uno panel a panel en la UI es parte del valor del capítulo. Una vez tengas uno, expórtalo y commitéalo.

### `docker-compose.obs.yml`

(Resumido — el archivo completo está en el repo)

```yaml
services:
  api:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://tempo:4318
    depends_on:
      tempo: { condition: service_started }

  prometheus:
    image: prom/prometheus:v3.0.1
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=2h
    ports: ["9090:9090"]
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:9090/-/ready"]

  tempo:
    image: grafana/tempo:2.6.1
    command: ["-config.file=/etc/tempo.yaml"]
    user: "0"
    ports: ["3200:3200"]
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3200/ready"]

  grafana:
    image: grafana/grafana:11.4.0
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
      GF_AUTH_DISABLE_LOGIN_FORM: "true"
    ports: ["3001:3000"]   # 3000 host está tomado por la api
    depends_on:
      prometheus: { condition: service_healthy }
      tempo: { condition: service_healthy }
```

Detalles:

- **`GF_AUTH_ANONYMOUS_*`** — Grafana sin login, full admin. **Solo dev**. En prod jamás.
- **Tempo `user: "0"`** — root porque escribe en `/var/tempo`. Alternativa más limpia: chown del volume en un init container. Para dev acepta el root.
- **Healthchecks** — todos los servicios los tienen. `depends_on: condition: service_healthy` encadena bien.

## Cómo arrancarlo

```bash
make obs-up
```

Output:

```
[+] Running 6/6
 ✔ Container ntsa-db-dev      Healthy
 ✔ Container ntsa-prometheus  Healthy
 ✔ Container ntsa-tempo       Healthy
 ✔ Container ntsa-api         Started
 ✔ Container ntsa-grafana     Started
 ✔ Container ntsa-web-dev     Started

  api:        http://localhost:3000/health
  web:        http://localhost:5173/
  Grafana:    http://localhost:3001/
  Prometheus: http://localhost:9090/
  Tempo API:  http://localhost:3200/ready
```

Para bajarlo:

```bash
make obs-down            # preserva datos
make obs-clean           # wipe completo (metric history, traces, dashboards)
```

## Lo que ves cuando entras a Grafana

Abre `http://localhost:3001`. Sin login (anon admin). En el menú lateral, **Connections → Data sources** ya tiene Prometheus y Tempo verdes (provisionados).

### Para métricas (Prometheus)

**Explore** (icono brújula) → **Prometheus**. Pega:

```promql
sum(rate(http_requests_total[1m])) by (route)
```

Tráfico real time. Hazlo más interesante generando carga:

```bash
for i in $(seq 1 100); do
  curl -s -X POST http://localhost:3000/users \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"u$i@example.com\",\"name\":\"User $i\"}" > /dev/null
done
```

Luego:

```promql
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))
```

p95 de latencia por ruta. Verás el `/users` POST destacar.

### Para traces (Tempo)

**Explore** → **Tempo**. En el query type, **TraceQL**. Pega:

```traceql
{ name = "user.create" }
```

Lista de spans `user.create` recientes. Clic en uno → **waterfall**: ves el span del HTTP server, anidado el span de `user.create`, atributos (`user.outcome`, `user.id`), duración por nivel.

Otras queries útiles:

```traceql
{ name = "POST" && status = error }                # peticiones POST que fallaron
{ duration > 100ms }                               # spans lentos
{ resource.service.name = "node-ts-starter-api" }  # solo nuestra api
```

### Service graph

**Explore** → **Tempo** → **Service Graph**. Visualiza qué servicio llama a qué (powered by Tempo's `metrics_generator`). Con solo nuestra api hay un nodo. Cuando añadas un downstream service (ejercicio del cap. 16), verás las flechas y latencias entre ellos.

### Correlación cross-pillar

El bonus que cambia la experiencia:

1. **Métricas → Traces** (via exemplars): histograma de latency en Prometheus muestra puntitos. Clic → traza específica que generó esa medida.
2. **Logs → Traces**: en cualquier log de tu api hay `traceId`. Pega en TraceQL `{ trace:id = "<traceId>" }` o en la barra de búsqueda de Tempo. Te lleva a la traza completa de ese request.
3. **Traces → Métricas**: dentro de una traza, **Span → Metrics** abre Prometheus en el rango temporal del span.

Tres clics, los tres pilares conectados.

## Diferencia entre `up-dev` y `obs-up`

| Target | Servicios levantados |
|--------|----------------------|
| `make up-dev` | api (con `OTEL_EXPORTER_OTLP_ENDPOINT` vacío → console exporter) + db + web |
| `make obs-up` | + tempo + prometheus + grafana, **y override** api con `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318` |

Cuando arrancas `obs-up`, la api **deja de spammear** spans a stdout y los empieza a mandar a Tempo. Los ves en Grafana en lugar de en la terminal. Y como sigue siendo el dev override (cap. 11), la api también usa Postgres local. Stack completo de dev observable.

## Trampas comunes

### 1. Puerto 3001 conflict con otro Grafana local

Si ya tienes algo en `:3001`, edita `docker-compose.obs.yml` y cambia el mapping (e.g., `3010:3000`).

### 2. Tempo "permission denied" en /var/tempo

Tempo's container intenta escribir el WAL. Sin `user: "0"` en compose, el volume montado da error. Si quieres seguir root-less, hay que `chown 10001:10001` el volume primero. Para dev, root está bien.

### 3. La api ya estaba corriendo cuando ejecutas `obs-up`

Si tenías `make up-dev` corriendo, `make obs-up` **recrea** la api porque cambia su env (`OTEL_EXPORTER_OTLP_ENDPOINT`). Esto es correcto pero corta requests en vuelo. Para evitarlo: `make down` antes.

### 4. Prometheus no scrapea al api: 'connection refused'

Verifica que api está en network `app` (lo está) y que es accesible como `api:3000` desde dentro. Desde el host es `localhost:3000`, pero **dentro de la red docker es `api:3000`** (el container name como hostname).

### 5. Tempo no recibe traces

Causas comunes:
- API no carga `tracing.ts` (falta `--import` en CMD). Verifica logs.
- `OTEL_EXPORTER_OTLP_ENDPOINT` no se está pasando. `docker compose config | grep OTEL` debería mostrar `http://tempo:4318`.
- `OTEL_SDK_DISABLED=true` está set en algún sitio.

Test de conectividad rápido desde el container del api:

```bash
docker compose exec api wget -qO- http://tempo:3200/ready
# debe responder "ready"
```

### 6. Cardinalidad explota en Prometheus

Si tu cap. 15 etiquetó algo mal (`user_id` como label, path literal en lugar de template), Prometheus crece sin parar. Síntoma: `prometheus` container con RAM growing forever. Para diagnosticar:

```promql
count by(__name__)({__name__=~".+"})
```

Lista cardinalidad por métrica. Si `http_requests_total` tiene 10.000+ series, busca cuáles labels divergen.

### 7. `block_retention: 1h` en Tempo te come tus pruebas

Si haces requests, los dejas estar 90min, y vuelves a Grafana — las trazas viejas ya no están. Ajusta `block_retention` para sesiones más largas, o `make obs-clean` y empieza de nuevo.

### 8. Grafana provisioning no carga

Si tras `make obs-up` no ves los datasources Prometheus/Tempo:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.obs.yml logs grafana | grep -i provision
```

Errores típicos: YAML malformed, path equivocado dentro del container, permisos del volume.

## Lo que NO hicimos (a propósito)

- **OpenTelemetry Collector** como middleman. El patrón senior: api → Collector → fan-out (Tempo + ¿OTLP a Honeycomb? + ...). Permite tail-based sampling, retry, transformations. Lo dejamos como ejercicio 1.
- **Loki para logs**. El tercer pilar nuestro está aún en `stdout` (capturado por Docker, leído por `docker logs`). Loki + Promtail completaría el "everything in Grafana". Ejercicio 2.
- **Dashboards-as-code**. Grafana JSON es brittle pero Grafonnet (Jsonnet) + Tanka, o Terraform `grafana_dashboard`, lo arreglan. Ejercicio 3.
- **Alerting con Alertmanager**. Definimos reglas en cap. 15 pero no las cargamos. Necesitas Alertmanager + reglas en Prometheus.
- **Persistencia real** de las DBs. Los volumes son named pero `make obs-clean` los borra. En prod: backups, retention policies, snapshots.
- **Multi-tenant**. Tempo, Prometheus, Grafana soportan tenant isolation. Para single-team setup no aplica.
- **Service-side discovery**. Static targets en Prometheus solo escala hasta cierto punto. En k8s usas `kubernetes_sd_configs`; en Consul, `consul_sd_configs`. En dev local los targets son fijos.

## Ejercicio

1. **OpenTelemetry Collector**: añade `otel-collector` (imagen `otel/opentelemetry-collector-contrib:0.115.0`) como middleman entre api y Tempo. Config: recibe OTLP, batch processor, exporta a Tempo. Cambia la api para apuntar al Collector en lugar de directamente a Tempo. Verifica que las trazas siguen llegando a Grafana.

2. **Loki + Promtail**: añade Loki (storage de logs) y Promtail (shipper que lee `/var/lib/docker/containers/*.log`). Configura Grafana con un tercer datasource Loki. Cierra el triángulo: log → click en `traceId` → trace. Pista: necesitas el field `derived_fields` en `loki-datasource`.

3. **Dashboard básico hand-crafted**: en Grafana, crea un dashboard con 4 paneles RED:
   - Rate: `sum(rate(http_requests_total[1m])) by (route)`
   - Errors %: `100 * sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`
   - p95 duration: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))`
   - Event loop lag p99: `nodejs_eventloop_lag_p99_seconds`
   
   Exporta el JSON. Commitéalo a `observability/dashboards/api-overview.json`. Provisiona en Grafana via `grafana-dashboards.yaml`.

4. **Reto — Tail sampling**: con el Collector del ejercicio 1, configura tail-based sampling para "exporta solo traces con error O p95 > 200ms". Genera 100 requests rápidos + 1 lento + 1 con error. Verifica que solo el lento y el con error aparecen en Tempo.

5. **Reto — Service graph con downstream**: levanta un segundo Hono mini-service (`api-downstream` en otro container). Haz que `POST /users` llame con `fetch` a `http://api-downstream:3001/notify`. Verifica que (a) el trace del request principal incluye un span outgoing de la llamada, (b) el downstream tiene sus propios spans con el mismo `traceId`, (c) Grafana's Service Graph muestra los dos nodos conectados.

6. **Reto — Alertmanager**: añade `prom/alertmanager` al compose. Configura reglas en `prometheus.yml`:
   ```yaml
   rule_files: ['/etc/prometheus/alerts.yml']
   alerting:
     alertmanagers:
       - static_configs:
           - targets: ['alertmanager:9093']
   ```
   Define dos alertas (error rate > 5%, p95 > 1s). Verifica con un curl spam que dispara.

7. **Reto — Logs en Loki con `traceId` como label**: configura Promtail para parsear los JSON de pino y extraer `traceId` como label searchable. Permite hacer `{traceId="xxx"}` en Loki y ver toda la cadena del request.

8. **Reto — Sampling adaptativo**: el SDK soporta `OTEL_TRACES_SAMPLER=parentbased_traceidratio`. Setéalo a 0.01 (1%). Mide con qué frecuencia llegan trazas al Tempo. Aumenta a 1.0. Compara.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — los nombres de spans, métricas y labels que vimos en cap. 15 y 16 son el "API" que consumes en estos dashboards. Cambiar `route` por `path` rompe alertas y dashboards en producción tanto como cambiar el nombre de un tipo.
- **[Item 76 — *Create an Accurate Model of Your Environment*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/model-env.md)** — los `external_labels` de Prometheus (`env: dev`, `cluster: local`) y los Resource attributes de OTel **son** el modelo del entorno. Tag wrong → agregaciones cross-env contaminadas → debug pesadilla.
- **[Item 65 — *Put TypeScript and `@types` in `devDependencies`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/dev-dependencies.md)** — análogo runtime: Prometheus / Grafana / Tempo no son producción, son **infraestructura de dev/staging local**. La separación importa: en prod usas un managed (Grafana Cloud, Honeycomb), no auto-hosteado.
- **[Item 78 — *Pay Attention to Compiler Performance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/performance.md)** — análogo runtime extremo: el `block_retention`, `scrape_interval`, cardinalidad de labels son los "compile-perf" del mundo observability. Sin tunear los conoces tarde, cuando la factura cloud o el OOM te pillan.

---

**Anterior:** [16 — OpenTelemetry tracing](./16-opentelemetry-tracing.md)
**Siguiente:** *(por decidir — deploy real, image signing + SBOM, OpenAPI/Scalar)*
