# 16 — OpenTelemetry tracing

## El problema

Tu API responde a `POST /users` en 250ms. **¿Dónde se fueron?** Con logs (cap. 12) sabes qué pasó. Con métricas (cap. 15) sabes que tardó 250ms. Lo que falta: **el desglose por dentro del request** — cuánto del tiempo fue parsing, cuánto fue la query `findByEmail`, cuánto el `save`, cuánto fue serialización de la respuesta.

Ese desglose se llama **trazado distribuido** (distributed tracing). Es el tercer pilar de la observabilidad:

| Pilar | Capítulo | Qué responde |
|-------|----------|--------------|
| **Logs** | 12 | "¿Qué pasó?" — eventos individuales |
| **Metrics** | 15 | "¿Cuánto y cómo de rápido?" — agregados |
| **Traces** | 16 (este) | "¿Por dónde pasó el tiempo?" — desglose causal |

Los tres son **independientes en captura**, **correlacionados en consumo**. Bien hechos, en un incidente saltas:

> dashboard de métricas detecta p95 > 1s → encuentras un request específico (log) → click en el trace → ves que la query Postgres tardó 800ms → click en el log de la query → contexto completo

Eso es lo que vamos a montar.

## OpenTelemetry — el estándar

[**OpenTelemetry**](https://opentelemetry.io/) (OTel) es el estándar CNCF para observabilidad, fruto de la fusión de OpenTracing y OpenCensus. Ha barrido la competencia:

- **API estándar**: el código de instrumentación es **agnóstico al vendor**. El mismo `tracer.startSpan()` funciona con Jaeger, Tempo, Honeycomb, Datadog, New Relic.
- **SDK** que recolecta, procesa, exporta.
- **Auto-instrumentations** que patchean librerías (HTTP, DB, fetch) sin tocar tu código.
- **Convenciones semánticas** estables (nombres de spans, atributos).

Hace 4 años elegir tracer era una decisión costosa (Zipkin? Jaeger? proprietary?). Hoy: **siempre OpenTelemetry**, y el backend se decide al final. Cambiar de Tempo a Honeycomb mañana es **cambio de URL del exporter**, no de código.

## Conceptos en 60 segundos

- **Span**: una unidad de trabajo. Tiene name, start time, duration, attributes, status. Ejemplo: "HTTP GET /users", "db.findByEmail".
- **Trace**: árbol de spans relacionados por `traceId`. Representa el flujo completo de un request.
- **Context propagation**: el `traceId` viaja entre servicios via headers (`traceparent`, W3C). Tu API recibe un trace ID del frontend, lo propaga al DB, al microservicio downstream, etc.
- **Exporter**: dónde van los spans al cerrarse. Console (stdout), OTLP HTTP/gRPC, Jaeger, vendor-specific.
- **Sampler**: decide si un trace se exporta o se descarta. Sin sampling, alto tráfico → too much data.

## El SDK setup — `src/tracing.ts`

```ts
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

if (process.env['OTEL_SDK_DISABLED'] !== 'true') {
  const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

  const exporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces` })
    : new ConsoleSpanExporter();

  const spanProcessor = otlpEndpoint
    ? new BatchSpanProcessor(exporter)
    : new SimpleSpanProcessor(exporter);

  const sdk = new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'node-ts-starter-api',
    spanProcessors: [spanProcessor],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = async () => { await sdk.shutdown().catch(() => {}); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

Senior detalles:

### `OTEL_SDK_DISABLED=true` como kill-switch

Convención oficial de OTel. Pone el SDK en off sin tocar código — útil en tests, en dev cuando el ruido molesta, en deploys de emergencia donde quieres aislar variables.

### Exporter condicional

- **Sin `OTEL_EXPORTER_OTLP_ENDPOINT`**: `ConsoleSpanExporter`. Spans van a stdout. Cero infraestructura. Perfecto para "ver qué hace OTel" la primera vez.
- **Con endpoint**: `OTLPTraceExporter` apuntando a un Collector / Tempo / Honeycomb. Estándar moderno.

### `SimpleSpanProcessor` vs `BatchSpanProcessor`

- **Simple**: cada span se exporta nada más cerrar. Útil para dev/console — los ves al instante.
- **Batch**: agrupa spans, exporta cada N segundos o cada N spans. **Único válido en producción** — el simple bloquea cada request en I/O.

Por eso el código discrimina: console = simple (inmediato, dev), OTLP = batch (eficiente, prod).

### `getNodeAutoInstrumentations` con disables

El paquete `auto-instrumentations-node` incluye **decenas** de instrumentations. Por defecto activa todas las que detecta como instaladas. Las que SIEMPRE se desactivan en senior setup:

- **`instrumentation-fs`** — un span por cada `fs.read`. Cualquier `require()` genera 50. Trace tree ilegible.
- **`instrumentation-dns`** — un span por cada `dns.lookup`. Mismo problema.

Las útiles (active por defecto si están instaladas):

- `instrumentation-http` — spans para Hono (server) y fetch outgoing
- `instrumentation-pg` — postgres (`pg` library)
- `instrumentation-mysql2` — MySQL
- `instrumentation-redis` — Redis
- `instrumentation-mongoose` — MongoDB
- `instrumentation-grpc` — gRPC

## El paso crítico: `--import`

Lo que mata el 80% de los setups de OTel en TS es **el orden de carga**. Las auto-instrumentations funcionan **patcheando el module loader**. Si tu código `import 'hono'` corre **antes** de que el SDK se inicie, las funciones HTTP de Hono ya están cacheadas sin patchear. Los spans nunca se generan.

Hay tres formas históricas de resolverlo:

1. **`-r ./src/tracing.js`** (legacy CJS, no funciona con ESM)
2. **Top-import en `src/index.ts`**: `import './tracing.ts'` como **primera** línea — funciona pero **frágil** (hoist de imports, bundlers reordenan).
3. **`--import ./src/tracing.ts`** (Node 20+, ESM-native) — **la correcta hoy**.

Nuestro `package.json`:

```jsonc
{
  "scripts": {
    "dev": "node --watch --experimental-strip-types --experimental-sqlite --env-file-if-exists=.env --import ./src/tracing.ts src/index.ts",
    "start": "node --experimental-strip-types --experimental-sqlite --env-file-if-exists=.env --import ./src/tracing.ts src/index.ts"
  }
}
```

Y el `Dockerfile.api`:

```dockerfile
CMD ["node", "--experimental-strip-types", "--experimental-sqlite", "--import", "./src/tracing.ts", "src/index.ts"]
```

**`--import` ejecuta `tracing.ts` como side-effect antes del entry point**. Las instrumentations patchean el loader, después se carga `index.ts` y todo lo que importa ya queda instrumentado.

### Por qué los tests NO cargan tracing.ts

Mira el script:

```jsonc
"test": "node --test --experimental-strip-types --experimental-sqlite 'src/**/*.test.ts'"
```

**Sin `--import`**. Razón: los tests son unitarios, no necesitan exportar spans, y `ConsoleSpanExporter` inundaría stdout con JSON entre los resultados de tests. `trace.getTracer()` del `@opentelemetry/api` cuando no hay SDK registrado devuelve un **NoopTracer** — `withSpan(...)` funciona transparentemente sin generar spans. Test code zero changes.

## Manual spans con `withSpan`

Auto-instrumentation cubre HTTP/fetch/DB. Pero la **lógica de negocio** (createUser, processPayment) **no tiene auto-instrumentation** por definición. Para eso, manual spans.

`src/lib/with-span.ts`:

```ts
import { trace, SpanStatusCode, type Span, type Attributes } from '@opentelemetry/api';

const tracer = trace.getTracer('node-ts-starter');

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) span.setAttributes(attributes);
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

Tres detalles:

- **`startActiveSpan`** (no `startSpan`): hace este span el **activo** durante la ejecución de `fn`. Cualquier span hijo creado dentro hereda automáticamente la relación parent-child.
- **`recordException` + `setStatus(ERROR)`**: convención semántica de OTel para "este span falló". Los UIs lo pintan en rojo.
- **`finally`**: `span.end()` siempre se llama. Sin esto, una excepción deja spans abiertos → memory leak.

Uso en `src/services/user-service.ts`:

```ts
import { withSpan } from '../lib/with-span.ts';

export function createUser(repo, payload) {
  return withSpan('user.create', async (span) => {
    const existing = await repo.findByEmail(payload.email);
    if (existing) {
      span.setAttribute('user.outcome', 'email_already_taken');
      return err({ kind: 'email_already_taken', email: payload.email });
    }

    const user = { id: newUserId(), ...payload };
    await repo.save(user);

    span.setAttributes({
      'user.outcome': 'created',
      'user.id': user.id,
    });
    return ok(user);
  });
}
```

Reglas senior para nombrar y etiquetar:

### Span names = verbos de dominio, no rutas HTTP

```
✅ user.create
✅ payment.charge
✅ order.fulfil

❌ POST /users      (eso ya lo hace el HTTP auto-instrumentation)
❌ createUser_v2    (camelCase con sufijos de versión es ruido)
```

### Atributos = contexto útil, no PII

```
✅ user.outcome      → "created" | "email_already_taken"
✅ user.id           → UUID (no PII por sí mismo)
✅ payment.amount_cents → 4200 (no muestres el card number)

❌ user.email        → PII
❌ user.password     → CATÁSTROFE
❌ request.body      → todo el body, normalmente PII
```

### Naming = `<dominio>.<acción>` con dots, no underscores

Convención OTel. Permite agrupar en UIs (`user.*`, `payment.*`).

## Correlación logs ↔ traces

El bonus que cambia la vida: **cada log lleva traceId/spanId** del span activo. Resultado: en Grafana / Honeycomb haces clic en un log de error y aterrizas en el trace exacto que lo causó.

Implementación en pino via `mixin`:

```ts
import { trace } from '@opentelemetry/api';
import { getRequestId } from './request-context.ts';

mixin: () => {
  const fields: { requestId?: string; traceId?: string; spanId?: string } = {};

  const requestId = getRequestId();
  if (requestId) fields.requestId = requestId;

  const spanCtx = trace.getActiveSpan()?.spanContext();
  if (spanCtx) {
    fields.traceId = spanCtx.traceId;
    fields.spanId = spanCtx.spanId;
  }

  return fields;
},
```

`trace.getActiveSpan()` lee el span actual del **OTel context** (que es ALS por debajo — usan la misma maquinaria que nuestro request-context.ts del cap. 12). Sin SDK cargado, devuelve undefined → no se añaden los campos. Sin coste cuando OTel está off.

Output de un log dentro de un request:

```json
{
  "level": 30,
  "time": 1709123456789,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "method": "POST",
  "path": "/users",
  "status": 201,
  "msg": "request"
}
```

Con este log y un UI moderno, **el clic en `traceId` te lleva al waterfall completo**.

## Verificación en vivo

Con `OTEL_SDK_DISABLED` no set y sin endpoint OTLP configurado:

```bash
make dev-api
# en otra terminal
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"jose@example.com","name":"Jose"}'
```

En la terminal del server verás, además del log normal:

```
{
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  parentId: 'a4f5b2c3...',
  name: 'user.create',
  id: '00f067aa0ba902b7',
  kind: 0,
  timestamp: 1709...,
  duration: 2841,
  attributes: {
    'user.outcome': 'created',
    'user.id': 'eef04a8d-f870-4097-8f8c-b8fb984cdded'
  },
  status: { code: 0 },
  ...
}
{
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  name: 'POST',
  id: 'a4f5b2c3...',
  kind: 1,                                    // SERVER kind
  timestamp: 1709...,
  duration: 5234,
  attributes: {
    'http.method': 'POST',
    'http.target': '/users',
    'http.status_code': 201,
    'http.flavor': '1.1',
    ...
  }
}
```

Dos spans, mismo `traceId`. El `user.create` (kind SPAN) tiene como `parentId` el id del `POST` (kind SERVER). Ese es **un trace** — el árbol del request entero.

## Limitación importante: `postgres` y `node:sqlite` sin auto-instrumentation

Las auto-instrumentations cubren `pg` (node-postgres) y `mysql2`, pero **no** [`postgres`](https://github.com/porsager/postgres) (el driver que usamos, cap. 11) ni `node:sqlite` (cap. 08). Las queries a la DB **no generarán spans automáticamente**.

Opciones:

### Opción A — Instrumentar manualmente cada query del repo

```ts
// src/repositories/postgres-user-repository.ts (versión instrumentada)
import { withSpan } from '../lib/with-span.ts';

export function createPostgresUserRepository(sql) {
  return {
    findByEmail(email) {
      return withSpan(
        'db.users.find_by_email',
        async (span) => {
          span.setAttribute('db.system', 'postgresql');
          span.setAttribute('db.operation', 'SELECT');
          const rows = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
          span.setAttribute('db.rows_affected', rows.length);
          if (rows.length === 0) return null;
          return UserSchema.parse(rows[0]);
        },
      );
    },
    save(user) {
      return withSpan('db.users.save', async (span) => {
        span.setAttributes({ 'db.system': 'postgresql', 'db.operation': 'UPSERT' });
        await sql`INSERT INTO users ... ON CONFLICT ...`;
      });
    },
  };
}
```

Costo: ruido en el repo. Beneficio: control total sobre nombres y atributos.

### Opción B — Hook en el driver (cuando expone uno)

`postgres` no expone hooks oficiales para tracing. Cerrado.

### Opción C — Esperar / contribuir auto-instrumentation

OTel acepta contribuciones de auto-instrumentations en `opentelemetry-js-contrib`. A futuro habrá `instrumentation-postgres` (porsager). Hoy: opción A.

En este proyecto **no lo hago** para mantener el repo simple de leer. Lo dejo como ejercicio. Mira las trazas en el browser cuando lo añadas — el árbol explota en detalle.

## Sampling

En producción no quieres exportar el 100% de los traces — el coste del backend (almacenamiento, índices) sería prohibitivo. **Sampling** decide qué traces se exportan.

Estrategias:

| Estrategia | Cuándo |
|-----------|--------|
| **AlwaysOn** | Dev y debugging |
| **AlwaysOff** | Tests, prod si quieres desactivar |
| **TraceIdRatioBased** | "1% de traces" — uniforme |
| **ParentBased** | Hereda decisión del span padre — útil para traces que cruzan servicios |
| **Tail-based** (en el Collector, no en el SDK) | "exporta este trace solo si tuvo error o latencia > X" — el santo grial pero requiere infra extra |

Configuración via env (estándar OTel):

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1                    # 10%
```

El SDK lo respeta automáticamente. No tocas código.

Para nuestro proyecto el default (`AlwaysOn`) es fine — bajo tráfico.

## Trampas comunes

### 1. Sin `--import`, las auto-instrumentations no patchean

Síntoma: ves el span `user.create` (manual) pero **no** el `POST /users` (HTTP server). Significa: HTTP se cargó antes que el SDK. Mueve la inicialización a `--import` o como **primer** import absoluto del entry.

### 2. `BatchSpanProcessor` en dev → no ves los spans

`BatchSpanProcessor` agrupa por defecto cada 5s o cada 512 spans. Si arrancas, haces 1 curl, y miras stdout: nada. Espera 5s o termina el proceso (en SIGTERM se hace flush). Por eso usamos `SimpleSpanProcessor` para console.

### 3. Spans abiertos sin cerrar

```ts
const span = tracer.startSpan('foo');
span.setAttribute(...);
// ❌ falta span.end()
```

Memory leak. El span vive en memoria hasta que el SDK shutdown lo desaloja. Con muchos requests → OOM. **Por eso `withSpan` envuelve siempre en `try/finally`**.

### 4. Exportar PII

```ts
span.setAttribute('user.email', payload.email);  // ❌
```

OTel UIs (Grafana, Honeycomb) indexan los atributos. Tu DPO encontrará emails en sistemas que no deberían tenerlos. **Atributos = categorías o IDs, no datos**.

### 5. Span names dinámicos

```ts
withSpan(`user.${payload.kind}.create`, ...)  // ❌
```

Con 100 tipos distintos de user, tienes 100 nombres de span. Los UIs los tratan como métricas separadas; pierdes agregación. **Mete `kind` como atributo** (`span.setAttribute('user.kind', payload.kind)`) y mantén el nombre estable.

### 6. `traceparent` no propagado en outgoing requests

Auto-instrumentation de `http`/`undici` lo hace por ti. Si manualmente haces `fetch` con headers explícitos, **no sobreescribas el header `traceparent`**. El siguiente servicio no podrá unir el trace.

### 7. `console.log` en lugar de logger estructurado

Tus logs ya llevan `traceId`/`spanId` gratis (cap. 12 + mixin de este cap.). Cualquier `console.log` salta esa correlación. **Solo logger.**

### 8. Confundir `traceId` con `requestId`

- `requestId` (nuestro, cap. 12): único por request entrante a este servicio. ALS-based.
- `traceId` (OTel, este cap.): único por **trace** — puede incluir múltiples requests entre servicios.

Si tu API solo recibe 1 request por trace, parecen lo mismo. En arquitectura multi-servicio, **divergen** — un cliente puede mandar 3 requests a 3 servicios que comparten un solo `traceId` pero tienen 3 `requestId`. Ambos son útiles.

## Lo que NO hicimos (a propósito)

- **OpenTelemetry Collector** local en docker-compose. Es el patrón senior canónico: SDK → Collector (sidecar) → backend(s). El Collector hace batching, retry, filtering, fan-out a múltiples backends. Ejercicio.
- **Auto-instrumentation manual de `postgres` y `node:sqlite`**. Lo cubre la sección "Limitación importante". Ejercicio.
- **Tail-based sampling**. Requiere el Collector. Permite "exporta este trace si tuvo error o p99 lento" — patrón senior real para producción de alto tráfico.
- **Custom Span Processors**. Filtrar/enriquecer spans antes de exportar (e.g., dropear spans `fs.read`).
- **Logs y métricas vía OTel** (no solo traces). OTel también define formato para logs y metrics. La integración existe pero hoy todavía gana usar pino y prom-client nativos. Cuando madure el ecosistema, drop-in replacement.
- **Resource detectors**. Auto-detectan que corres en GKE, AWS Lambda, k8s, etc. y añaden labels al recurso. `@opentelemetry/resources` + `@opentelemetry/resource-detector-*`.

## Ejercicio

1. **Console exporter live**: arranca el server, haz 3 `POST /users` distintos. Mira en stdout los spans `POST` (HTTP server, kind=SERVER) y `user.create` (kind=INTERNAL). Confirma que comparten `traceId` y que `user.create.parentId === POST.id`.

2. **Logs↔traces correlation**: copia el `traceId` de un span. Busca en los logs (`make dev-api | grep <traceId>`) las líneas con ese trace. Confirma que aparecen los logs de "request" del request middleware.

3. **OpenTelemetry Collector en compose**: añade un servicio `otel-collector` al `docker-compose.dev.yml` con `otel/opentelemetry-collector:0.96` y un `otel-collector-config.yaml` mínimo (receivers: otlp, exporters: logging). Apunta el api con `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`. Verifica que los spans llegan al log del collector.

4. **Jaeger en compose**: añade `jaegertracing/all-in-one:1.60` (UI en :16686). El Collector lo añades como exporter. Visualiza el waterfall en el browser.

5. **Instrumenta el repo Postgres**: aplica el patrón "Opción A" de la sección "Limitación importante" a `postgres-user-repository.ts`. Mira el trace — ahora tiene 3 niveles: `POST → user.create → db.users.find_by_email`.

6. **Sampling al 10%**: pon `OTEL_TRACES_SAMPLER=traceidratio` y `OTEL_TRACES_SAMPLER_ARG=0.1`. Manda 100 requests. Verifica que solo ~10 traces aparecen.

7. **Reto — Tail-based sampling**: configura el Collector con tail sampling: "exporta solo traces con error O latency > 500ms". Pista: `processors.tail_sampling.policies`.

8. **Reto — Custom span processor**: implementa un `SpanProcessor` que añada `deployment.environment=production` a cada span en runtime. Más simple: mete en `resource.attributes`. Más senior: usa `BatchSpanProcessor.onStart` o un processor wrapper.

9. **Reto — Propagación a un segundo servicio**: levanta un mini-servicio downstream (otro Hono) que el api llame con `fetch`. Verifica que el `traceparent` viaja y los spans del downstream aparecen en el mismo trace.

10. **Reto — Reemplaza `prom-client` por OTel metrics**: cambia el `prom-client` del cap. 15 a `@opentelemetry/sdk-metrics` con `PrometheusExporter`. Mantén el endpoint `/metrics`. Compara el código y los outputs.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — los nombres de spans (`user.create`, `payment.charge`) son nombres del dominio, no de implementación. La misma regla que aplicamos a tipos vale para spans y métricas: **es API pública** (alertas, runbooks dependen de ellos).
- **[Item 76 — *Create an Accurate Model of Your Environment*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/model-env.md)** — los Resource attributes (`service.name`, `deployment.environment`) **modelan el entorno** en el observability backend. Sin un modelo correcto, agregaciones por servicio/región/versión son ruido.
- **[Item 27 — *Use async Functions Instead of Callbacks to Improve Type Flow*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/use-async-await.md)** — `withSpan` retorna `Promise<T>` y propaga T del callback. Sin async/await el tipado se rompe (callback-hell + ts gymnastics).
- **[Item 33 — *Push Null Values to the Perimeter of Your Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/null-values-to-perimeter.md)** — `span.recordException` + `setStatus(ERROR)` empuja el error a los bordes del trace. Mismo principio que cap. 12 (business vs infra), llevado a observability.

---

**Anterior:** [15 — Métricas con Prometheus](./15-metricas-prometheus.md)
**Siguiente:** [17 — Stack de observabilidad local](./17-observabilidad-stack.md)
