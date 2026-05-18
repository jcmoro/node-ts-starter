# 15 — Métricas con Prometheus

## El problema

Los **logs** del capítulo 12 son perfectos para investigar **un evento concreto**: "user X reportó error a las 14:32, dame todo lo que pasó en ese request". Pero hay preguntas que los logs **no responden bien**:

- ¿Cuántos requests por segundo está sirviendo el API ahora mismo?
- ¿Cuál es la latencia p95 del endpoint `/users` en la última hora?
- ¿Cuántos 5xx ha habido en las últimas 24h?
- ¿El event loop está saturado?
- ¿Mi heap está creciendo de forma sospechosa?

Para esto necesitas **métricas**: series temporales de números agregados, no eventos individuales. Es el segundo pilar de la observabilidad (logs → métricas → traces).

| Aspecto | Logs | Métricas |
|---------|------|----------|
| Unidad | Evento individual | Agregado (count, sum, bucket) |
| Cardinalidad | Alta (cada evento único) | Baja (labels acotados) |
| Retención | Días (caro) | Meses/años (barato) |
| Latencia | Por evento | Por scrape (~15s) |
| Caso de uso | Debug de un request | Alertas, dashboards, tendencias |
| Storage típico | Loki, Elasticsearch | Prometheus, VictoriaMetrics |

**No se sustituyen**. Se complementan.

## El método RED y los four golden signals

Dos frameworks senior para decidir **qué métricas exponer**:

### RED (RPC services)

Tres números por endpoint:

- **Rate** — requests por segundo
- **Errors** — tasa de errores
- **Duration** — distribución de latencia (p50, p95, p99)

Si tienes esos tres para cada ruta, puedes diagnosticar el 80% de incidencias.

### USE (resources)

Para cada recurso (CPU, memoria, disco, red):

- **Utilization** — % en uso
- **Saturation** — work pendiente / queue depth
- **Errors** — fallos del recurso

### Four Golden Signals (Google SRE)

Para servicios cara al usuario:

- Latency, Traffic, Errors, Saturation

Para este capítulo: nos enfocamos en **RED** (somos un servicio HTTP) más default metrics de Node (USE-ish para el proceso).

## `prom-client` — el cliente Node de referencia

```bash
npm install prom-client
```

[`prom-client`](https://github.com/siimon/prom-client) (~50KB, sin deps, mantenido desde 2014) es el cliente Prometheus para Node. Tres conceptos clave:

- **Registry** — colección de métricas que se expone vía `/metrics`.
- **Metric types** — `Counter`, `Gauge`, `Histogram`, `Summary`.
- **Labels** — dimensiones de una métrica (e.g. `method`, `route`, `status_code`).

### Los cuatro tipos

| Tipo | Cuándo |
|------|--------|
| **Counter** | Solo sube. Total requests, total errors. |
| **Gauge** | Sube y baja. Conexiones activas, queue depth. |
| **Histogram** | Distribución por buckets. **Latencias** (RED's D). |
| **Summary** | Cuantiles calculados en el cliente. Casi nunca. Histogram es mejor. |

> 💡 **Histogram vs Summary**: Histogram expone buckets; Prometheus calcula percentiles agregando entre instancias. Summary calcula percentiles **localmente** y los expone — pero **no se pueden agregar entre instancias** (no puedes sumar p95 de dos pods). Para servicios distribuidos, siempre Histogram.

## Implementación: `src/lib/metrics.ts`

```ts
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type Metrics = {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code'>;
};

export function createMetrics(): Metrics {
  const registry = new Registry();

  // Default metrics: process CPU, RSS, heap, GC, event loop lag, FDs.
  // Pull-based: registry.metrics() snapshots on demand.
  collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  return { registry, httpRequestsTotal, httpRequestDurationSeconds };
}
```

Detalles senior:

### 1. Factory en lugar de singleton

Singleton sería más conciso, pero **mata el aislamiento entre tests** (counters de un test contaminan al siguiente). El patrón `createMetrics()` da tests con su propio registry, igual que `createInMemoryUserRepository()` (cap. 07).

### 2. Tipado de labels

```ts
Counter<'method' | 'route' | 'status_code'>
```

`prom-client` permite tipar los labels como un union literal. Si haces `.inc({ method: 'GET', whatever: '...' })` con un label no declarado, **TS lo caza**. Sin esto, un typo en `status_kode` pasa silencioso y se crea una nueva serie.

### 3. Las default metrics

`collectDefaultMetrics({ register })` registra:

- `process_cpu_user_seconds_total`, `process_cpu_system_seconds_total`
- `process_resident_memory_bytes` (RSS)
- `process_start_time_seconds` (uptime)
- `nodejs_heap_size_total_bytes`, `nodejs_heap_size_used_bytes`
- `nodejs_external_memory_bytes`
- `nodejs_eventloop_lag_*` (p50/p90/p99 del lag del event loop)
- `nodejs_active_handles_total`, `nodejs_active_requests_total`
- `nodejs_gc_duration_seconds`

**Esto es oro gratuito**. Sin escribir una línea, tienes la salud del proceso. Imprescindible para diagnosticar memory leaks o saturación de event loop.

### 4. Buckets del histogram

`[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` (segundos).

Estos son los defaults razonables para HTTP web. Cubren desde 5ms hasta 10s. Si tu app tiene operaciones submillisegundo (cache hits, lookups en memoria), añade buckets más cortos. Si tienes operaciones de minutos (ML inference), añade más largos.

**Trampa típica**: dejar los defaults de `prom-client` antiguo (`[0.1, 5, 15, 50, 100, 500]`) — eso son **segundos**, así que el bucket más bajo es 100ms. La mayoría de tus requests rápidos caen todos en el primer bucket y pierdes resolución.

## Middleware: `src/middleware/metrics.ts`

```ts
import type { MiddlewareHandler } from 'hono';
import type { Metrics } from '../lib/metrics.ts';

const METRICS_PATH = '/metrics';

export function metricsMiddleware(metrics: Metrics): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === METRICS_PATH) {
      return next();
    }

    const start = performance.now();
    try {
      await next();
    } finally {
      const durationSeconds = (performance.now() - start) / 1000;
      const route = c.req.routePath || c.req.path;
      const labels = {
        method: c.req.method,
        route,
        status_code: String(c.res.status),
      } as const;

      metrics.httpRequestsTotal.inc(labels);
      metrics.httpRequestDurationSeconds.observe(labels, durationSeconds);
    }
  };
}
```

Tres puntos críticos:

### `c.req.routePath` — no `c.req.path`

`c.req.path` es el **literal** (`/users/abc-123-def-456`). `c.req.routePath` es el **template** (`/users/:id`). **SIEMPRE usar el template**. Si etiquetas por literal, cada UUID crea una nueva serie temporal — explosión de cardinalidad, OOM del servidor Prometheus, factura cloud por las nubes.

> 💡 **Regla**: si una label puede tomar más de ~100 valores distintos por instancia, **es PII o un ID** y no debe ir como label. Va al log, no a la métrica.

### Skip de `/metrics`

Si registramos el scrape, cada vez que Prometheus hace su pull crea entradas. Esto se llama "self-feedback" y te ahoga la métrica de "request rate" con tráfico interno.

### `try/finally` para errores

Si el handler lanza, el error middleware lo convierte a 500. El status correcto queda en `c.res.status` cuando el `finally` corre. Resultado: **los 500 también se loggean en la métrica**, no se escapan.

## El endpoint `/metrics`

```ts
app.get('/metrics', async (c) => {
  c.header('Content-Type', deps.metrics.registry.contentType);
  return c.body(await deps.metrics.registry.metrics());
});
```

`registry.metrics()` devuelve un string en el **formato Prometheus exposition** (texto plano, una línea por sample):

```
# HELP http_requests_total Total HTTP requests processed
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/health",status_code="200"} 3
http_requests_total{method="POST",route="/users",status_code="201"} 1
# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/health",status_code="200",le="0.005"} 3
http_request_duration_seconds_bucket{method="GET",route="/health",status_code="200",le="0.01"} 3
http_request_duration_seconds_count{method="GET",route="/health",status_code="200"} 3
http_request_duration_seconds_sum{method="GET",route="/health",status_code="200"} 0.000124
```

Prometheus hace scrape cada 15s (configurable), persiste cada sample con timestamp.

## PromQL — consultar las métricas

Las queries más útiles para nuestro setup:

### Rate (R de RED)

```promql
# Requests por segundo, agrupado por ruta
sum(rate(http_requests_total[1m])) by (route)

# Lo mismo desglosado por status
sum(rate(http_requests_total[1m])) by (route, status_code)
```

`rate()` calcula la pendiente de un counter (cuántos incrementos por segundo en la ventana).

### Errors (E de RED)

```promql
# Tasa de error como % del total
sum(rate(http_requests_total{status_code=~"5.."}[1m]))
  / sum(rate(http_requests_total[1m]))
```

### Duration (D de RED) — el motivo del histogram

```promql
# p95 de latencia por ruta
histogram_quantile(
  0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)
)

# p99
histogram_quantile(
  0.99,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)
)
```

`histogram_quantile` interpola entre buckets. Por eso los buckets importan: si tu p95 cae en el bucket "0.5 a 1s", el quantile va a interpolar y devolver algo entre 0.5 y 1. Si quieres precisión cerca del p95, añade buckets en esa zona.

### Saturación del event loop

```promql
nodejs_eventloop_lag_p99_seconds
```

Si este valor supera ~0.1s, tu Node está saturado y los requests están sentados en cola. **Alerta crítica de producción.**

### Memory leak

```promql
# Heap creciendo monótonicamente
deriv(nodejs_heap_size_used_bytes[1h]) > 0
```

## Alerting (mención)

Con las métricas, defines alertas en Prometheus. Ejemplos:

```yaml
groups:
  - name: api
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status_code=~"5.."}[5m]))
            / sum(rate(http_requests_total[5m])) > 0.05
        for: 10m
        labels:
          severity: critical
      
      - alert: SlowEndpoint
        expr: |
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket{route="/users"}[5m]))
            by (le)) > 1
        for: 15m
```

Alertmanager se conecta a Prometheus y dispara notifications (Slack, PagerDuty, email).

## Verificación en vivo

Con el servidor arrancado:

```bash
make dev-api
# en otra terminal
curl -s http://localhost:3000/health > /dev/null
curl -s http://localhost:3000/health > /dev/null
curl -s http://localhost:3000/ready > /dev/null
curl -s http://localhost:3000/metrics | head -30
```

Verás algo así:

```
# HELP http_requests_total Total HTTP requests processed
http_requests_total{method="GET",route="/health",status_code="200"} 2
http_requests_total{method="GET",route="/ready",status_code="200"} 1
# HELP http_request_duration_seconds HTTP request duration in seconds
http_request_duration_seconds_bucket{method="GET",route="/health",status_code="200",le="0.005"} 2
...
# HELP nodejs_eventloop_lag_p99_seconds The 99th percentile of the recorded event loop delays.
nodejs_eventloop_lag_p99_seconds 0.000123
```

## Trampas comunes

### 1. Labels con cardinalidad alta

```ts
metrics.requestsTotal.inc({ user_id: req.user.id }); // ❌
```

10.000 usuarios → 10.000 series. Cada serie ocupa unos ~3KB en Prometheus. **30MB por esa label.** Multiplicado por las demás dimensiones, OOM.

**Senior rule**: las labels son **categorías acotadas**, no IDs. Route templates, status codes, regiones, severidades. NUNCA user IDs, request IDs, paths literales, timestamps.

### 2. Histograms sin buckets adaptados

`Histogram` con buckets default genéricos puede meter el 95% de tus requests en un bucket. Pierdes resolución del p95. **Tunéalos a tu rango real**.

### 3. Counter que decrementa

```ts
counter.inc(-1); // ❌ technically allowed; semantically wrong
```

Counters solo suben. Si necesitas algo que sube y baja, usa Gauge. Reset solo en restart del proceso.

### 4. Olvidar el `Content-Type`

Si `/metrics` devuelve `application/json` o `text/html`, Prometheus no parsea. **Usa `registry.contentType`**, que devuelve el header correcto (`text/plain; version=0.0.4; charset=utf-8`).

### 5. Exponer `/metrics` públicamente

En producción, **`/metrics` no debería estar accesible desde Internet**. Expone métricas internas que pueden filtrar info sensible (rutas internas, frecuencias de uso, etc.). Práctica senior:

- En k8s: scrape solo desde el cluster (network policy).
- Detrás de un LB: deniega `/metrics` a IPs externas (nginx `location /metrics { deny all; allow <prometheus-ip>; }`).
- O un endpoint en otro puerto (privado).

Para este proyecto, lo dejamos abierto porque es didáctico.

### 6. Sumar percentiles entre instancias

```promql
avg(histogram_quantile(0.95, ...)) by (...)  # ❌
```

**Promediar percentiles es matemáticamente incorrecto**. La forma correcta: agregar los buckets `_bucket` con `sum by (le, ...)` y entonces calcular el quantile. Como en los ejemplos PromQL más arriba.

### 7. `/health` y `/ready` sí cuentan, pero no son la métrica importante

Los healthchecks meten ruido en `http_requests_total`. Para producción puedes querer excluirlos o etiquetarlos por separado. En nuestro proyecto los dejamos para no complicar.

## Lo que NO hicimos (a propósito)

Cada uno podría ser su propio capítulo:

- **Prometheus + Grafana en docker-compose**: levantar la stack completa local con un dashboard pre-cargado. Es ~30 líneas más de compose. Ejercicio.
- **Alertmanager + reglas de alertas**: las reglas que vimos quedan como código, no se hacen activas.
- **Push gateway** (para batch jobs que terminan antes del scrape): nicho.
- **VictoriaMetrics**: drop-in replacement de Prometheus, más rápido y eficiente. Cuando tu Prometheus empieza a doler.
- **OpenTelemetry metrics**: estándar emergente que abstrae Prometheus/StatsD/Datadog. Filosóficamente correcto pero hoy todavía verboso. El siguiente paso natural.
- **Cardinality budgets**: límites duros por servicio para evitar explosión accidental. Senior real las pone en CI.

## Ejercicio

1. **Verifica el endpoint**: arranca el server, haz 5-10 requests variadas, mira `/metrics`. Confirma que las labels son templates (`/users`, no `/users/abc-123`).

2. **Compose stack con Prometheus**: añade un servicio `prometheus` a `docker-compose.yml` que scrape `api:3000/metrics` cada 15s. Pista: `prom/prometheus:v3.0.0` con un `prometheus.yml` que defina un job. Verifica con `localhost:9090` que ve los targets en verde.

3. **Añade Grafana**: `grafana/grafana:11` apuntando a Prometheus. Crea un dashboard manual con: req rate por ruta, p95 por ruta, error rate %, event loop lag p99.

4. **Endpoint paramétrico**: añade `GET /users/:id` que llame a un (nuevo) `userRepo.findById`. Verifica que la métrica usa `/users/:id` como label `route`, no el UUID literal.

5. **Custom counter de negocio**: añade un `userCreatedTotal` counter que se incrementa en `user-service.ts` cuando `createUser` devuelve `ok`. Decide si la label `source` (por ahora siempre `"http"`) tiene sentido aún sin más vías.

6. **Reto — Buckets adaptados**: mide la distribución real de tus latencias con `histogram_quantile`. Decide si los buckets default son adecuados o necesitan reajuste para tu p99.

7. **Reto — Excluir healthchecks**: modifica el middleware para no registrar `/health` y `/ready` (son tráfico interno). ¿Qué pierdes? ¿Qué ganas?

8. **Reto — Cardinality test**: añade un counter con label `email` (alto-cardinal, mala práctica). Hace 100 requests con emails distintos. Compara el output de `/metrics` antes y después. Visualiza por qué la disciplina importa.

9. **Reto — OpenTelemetry**: reemplaza `prom-client` por `@opentelemetry/sdk-metrics` con el `PrometheusExporter`. ¿Qué API cambia? ¿Qué te aporta el cambio?

10. **Reto — Alert rules**: define en YAML las reglas de alerta para "error rate > 5% sostenido 10min" y "p95 > 1s sostenido 15min". Pásalas por `promtool check rules`.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — los nombres de las métricas (`http_requests_total`, `nodejs_eventloop_lag_seconds`) **son** el dominio observabilidad. Cambiarlos rompe alertas, dashboards y runbooks. Senior treat them as a public API.
- **[Item 34 — *Prefer Unions of Interfaces to Interfaces with Unions*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/union-of-interfaces.md)** — los labels de `prom-client` se tipan como un union literal (`'method' | 'route' | 'status_code'`). Es el mismo patrón.
- **[Item 76 — *Create an Accurate Model of Your Environment*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/model-env.md)** — tu Metrics object es un dep más como logger/health. Las default metrics (heap, GC, event loop) **modelan el entorno** y te avisan cuando se desvía.
- **[Item 78 — *Pay Attention to Compiler Performance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/performance.md)** — análogo runtime: pinear performance es la única vía de detectar regresiones. Las métricas hacen para producción lo que `tsc --diagnostics` hace para compile time.

---

**Anterior:** [14 — Type-level testing](./14-type-level-testing.md)
**Siguiente:** [16 — OpenTelemetry tracing](./16-opentelemetry-tracing.md)
