# 12 — Error handling estructurado y observabilidad

## El problema

Hasta ahora nuestro server tenía cuatro carencias críticas:

1. **`console.log` para todo.** Imposible filtrar por nivel, sin contexto estructurado, ilegible cuando hay carga.
2. **Errores sin manejar se vuelven 500 silenciosos.** Si el Postgres se cae, el cliente recibe `internal server error` y nosotros no nos enteramos hasta que alguien se queja.
3. **No hay forma de correlacionar logs con requests.** Cuando ves "create user falló" en un log, no sabes qué request lo provocó, qué payload tenía, ni qué pasó antes/después.
4. **El healthcheck miente.** Devuelve 200 incluso si la DB está caída. K8s o el LB no se enteran.

Las cuatro tienen solución conocida y bien tipada en TS. Este capítulo las cubre como las cubriría un senior.

## El modelo de errores: business vs infra

Antes de teclear logger, decide **qué consideramos error**. La distinción crítica:

| Tipo            | Ejemplo                          | Cómo viaja            | Status HTTP          |
|-----------------|----------------------------------|-----------------------|----------------------|
| **Business**    | "email already taken"            | `Result<T, E>` (cap. 04) | 4xx (cliente)     |
| **Validation**  | "email no es válido"             | `Result` desde Zod    | 400                  |
| **Infra**       | "connection to DB lost"          | `throw` (propaga)     | 500 (nuestro)        |
| **Programmer** | invariante violada, never reached | `throw` (bug)         | 500 (nuestro)        |

Los **business + validation** son **esperados y forman parte del contrato**. El llamador decide qué hacer. **NO se loggean a `error`** — son flow normal.

Los **infra + programmer** son **inesperados, son nuestro problema**. Se loggean a `error` con stack, y devolvemos un 500 genérico al cliente (sin filtrar info interna).

> 💡 **Anti-patrón habitual**: envolver todo en `Result`, incluido los errores de DB. Suena puro pero termina en código donde **cada función** discrimina 5 variantes de error. El runtime ya tiene un mecanismo perfecto para errores no esperados (excepciones); úsalo. **Result para lo que esperabas, throw para lo que no**.

## Logger estructurado con pino

```bash
npm install pino
npm install -D pino-pretty
```

### Por qué pino

- **Sub-millisegundo por log**. Importa cuando tienes carga.
- **NDJSON nativo**: una línea = un JSON. Es lo que esperan Docker, k8s, Loki, Datadog.
- **Child loggers**: heredan campos. Útil para "todos los logs de esta request llevan requestId".
- **Transports en worker threads**: pretty-print no bloquea el event loop.

Alternativas: `winston` (más viejo, más lento), `bunyan` (autor original, ahora abandonado), `consola` (más bonito, menos producción).

### `src/lib/logger.ts`

```ts
import { pino, type Logger } from 'pino';
import type { Env } from '../env.ts';
import { getRequestId } from './request-context.ts';

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    mixin: () => {
      const requestId = getRequestId();
      return requestId ? { requestId } : {};
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}
```

Tres detalles que pagan:

1. **`mixin`**: una función que devuelve campos a añadir **en cada log**. Pull en lugar de push: no necesitas crear un child logger por request — los logs **se enriquecen solos** desde el contexto async.
2. **`transport` solo en dev**: en prod, el logger escribe NDJSON crudo a stdout. Docker lo captura tal cual y los agregadores lo indexan. **Cero overhead**.
3. **`pino-pretty` como devDependency**: en producción nunca se carga (la condición está en runtime), así que `npm ci --omit=dev` lo deja fuera de la imagen.

### Comparación de output

**Dev** (`pino-pretty`):

```
[11:10:07.981] INFO: request
    requestId: "ccf509e8-4f4a-4bf1-bd69-db12efe6440f"
    method: "GET"
    path: "/health"
    status: 200
    duration_ms: 1
```

**Producción** (NDJSON puro):

```
{"level":30,"time":1779102625567,"pid":14977,"hostname":"...","requestId":"ccf509e8-...","method":"GET","path":"/health","status":200,"duration_ms":1,"msg":"request"}
```

El segundo es lo que `loki`/`datadog`/`elasticsearch` indexan. Niveles pino numéricos: `10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal`.

## Request context con `AsyncLocalStorage`

### El problema sin contexto

Imagina que llamas a `userService.create(payload)` desde un handler HTTP. La función está 3 niveles deep en la pila. Quiere loggear "se ha creado un user". ¿Cómo sabe el `requestId` del request que la originó?

Opciones:

1. **Pasarlo como argumento**. Funcional, explícito, pero contamina **todas** las firmas (`createUser(repo, payload, requestId, logger, traceId, ...)`). Ridículo a las 10 funciones.
2. **Variable global**. Funciona en single-threaded pero **falla en concurrencia**: dos requests a la vez se pisan el `currentRequestId`.
3. **AsyncLocalStorage**. El equivalente al "thread local" de otros lenguajes, pero correcto para el event loop async.

### Qué es `AsyncLocalStorage`

API nativa de Node (estable desde 16). Te da un **store** que se propaga **automáticamente** a través de cualquier cadena `await`/`Promise`/`setTimeout` que ocurra dentro de su `.run()`. Cada llamada `run` tiene su propio store, aislada de otras concurrentes.

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ requestId: string }>();

storage.run({ requestId: 'r-1' }, async () => {
  await someAsyncThing();
  console.log(storage.getStore()?.requestId); // 'r-1', siempre
});
```

> 💡 **Comparación**: `ThreadLocal<T>` de Java. `goroutine context` de Go (aunque éste es explícito). `contextvars` de Python. Es la primitiva canónica de "datos request-scoped" en runtimes async.

### `src/lib/request-context.ts`

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
```

20 líneas. El logger lo llama desde su `mixin`, así que **cualquier `logger.info(...)` dentro del request lleva `requestId` automáticamente**, sin que nadie tenga que recordarlo.

### Tradeoff de ALS

- **Overhead**: ~5% por await en microbenchmarks. Para apps normales, irrelevante.
- **Hidden state**: el código se vuelve **menos puro**. Una función que llama a `getRequestId()` ya no es testeable sin un wrapper `runWithRequestContext`.
- **Solo para cross-cutting concerns**: requestId, traceId, tenantId, userId. Para lógica de negocio, **explícito siempre**.

## Middlewares Hono: el orden importa

El `app.ts` queda así:

```ts
app.use(requestIdMiddleware());        // 1. propaga ALS
app.use(requestLoggerMiddleware(logger)); // 2. registra el request

app.get('/health', ...);                // ← handlers
app.get('/ready', ...);
app.post('/users', ...);

app.onError(errorHandler(logger));     // ← captura throws no atrapados
```

Por qué este orden:

1. **`requestId` debe ir antes que cualquier middleware que loggee**, o los logs no llevarán el ID.
2. **`requestLogger` debe envolver toda la lógica** para loguear incluso si lanza (usa `try/finally`).
3. **`onError` debe ser el último** — Hono lo registra como handler especial, no como middleware en la cadena.

### El middleware `requestId`

```ts
const HEADER = 'x-request-id';

export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(HEADER);
    const requestId = isValidRequestId(incoming) ? incoming : crypto.randomUUID();

    c.header(HEADER, requestId);
    c.set('requestId', requestId);

    await runWithRequestContext({ requestId }, () => next());
  };
}

function isValidRequestId(value: string | undefined): value is string {
  if (!value) return false;
  if (value.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(value);
}
```

Tres detalles senior:

- **Honra `X-Request-Id` si viene del cliente** (típico de gateways como API Gateway, Cloudflare). Si no, genera uno.
- **Lo valida**: longitud ≤128, charset restringido. Sin esto, un atacante puede meter `\n` en el header y **partir tus logs estructurados** (log injection). Real vulnerability, raramente protegida.
- **`runWithRequestContext` envuelve `next()`**: todo lo que pase dentro del request hereda el contexto. El logger lo recogerá vía `mixin`.

### El middleware `requestLogger`

```ts
export function requestLoggerMiddleware(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    try {
      await next();
    } finally {
      const duration = Math.round(performance.now() - start);
      logger.info(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          duration_ms: duration,
        },
        'request',
      );
    }
  };
}
```

- **`try/finally`**: si el handler lanza, el `onError` global lo captura, pero **el log de request se emite igual** (con el status que haya quedado).
- **NO loggea el body**. Es donde vive el PII (emails, passwords, tokens). Si quieres audit log, hazlo en un middleware separado opt-in por ruta.
- **`duration_ms` redondeado**. Suficiente para alertas; submillisegundo no aporta.

### El `errorHandler`

```ts
import { HTTPException } from 'hono/http-exception';

export function errorHandler(logger: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    const requestId = getRequestId();

    logger.error(
      { err, method: c.req.method, path: c.req.path },
      'unhandled error',
    );

    return c.json(
      { error: 'internal server error', ...(requestId ? { requestId } : {}) },
      500,
    );
  };
}
```

Dos paths:

- **`HTTPException`**: Hono permite `throw new HTTPException(404, { message: '...' })` para forzar un status concreto. El handler **lo respeta** — el código pidió explícitamente ese status.
- **Cualquier otro `Error`**: es un **bug nuestro**. Loggear con stack (`err` se serializa por pino con stack incluido), responder 500 genérico, **incluir el `requestId`** en el body para que el cliente nos lo pueda dar al reportar.

**Clave**: el cliente recibe `{"error": "internal server error", "requestId": "xxx"}`. **Nunca** el mensaje original de la excepción, **nunca** el stack. Eso lleva info de implementación que ayuda a atacantes y avergüenza en interviews ("vimos que usas SQLAlchemy 1.4 con un endpoint vulnerable").

## Liveness vs Readiness

Convención Kubernetes que es **estándar de facto** incluso si no usas K8s:

| Endpoint    | Pregunta                          | Si falla, hacer...         |
|-------------|-----------------------------------|----------------------------|
| `/health` (liveness)  | "¿Está vivo el proceso?" | **Reinicia el pod**        |
| `/ready` (readiness)  | "¿Puede servir tráfico?" | **Sácalo del load balancer** (no reinicies) |

La trampa clásica: hacer que `/health` toque la DB. Si la DB se cae, **todos los pods fallan liveness**, K8s los reinicia, vuelven a fallar, **cascade restart loop**. Pesadilla.

La distinción correcta:

- **Liveness**: respondo HTTP, mi event loop no está congelado, mi código no se ha colgado. **NO toca la DB**.
- **Readiness**: ¿estoy listo para procesar requests? Toca dependencias críticas (DB, cache, queue).

```ts
app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/ready', async (c) => {
  try {
    await deps.health.database();
    return c.json({ status: 'ready' });
  } catch (err) {
    deps.logger.warn({ err }, 'readiness check failed');
    return c.json({ status: 'not_ready', reason: 'database' }, 503);
  }
});
```

503 Service Unavailable es el código correcto. Los LB lo reconocen.

### El `HealthCheck` como dep

`src/db/health.ts`:

```ts
export type HealthCheck = { database(): Promise<void> };

export function createSqliteHealthCheck(db: DatabaseSync): HealthCheck {
  return { database: async () => { db.prepare('SELECT 1').get(); } };
}

export function createPostgresHealthCheck(sql: PostgresClient): HealthCheck {
  return { database: async () => { await sql`SELECT 1`; } };
}
```

Cada backend (SQLite, Postgres) trae **su propia** implementación. El `app.ts` recibe el `HealthCheck` por `deps`, sin saber qué hay detrás. **Mismo patrón que `UserRepository`**: interface única, factory por backend.

### Update del `Dockerfile`

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -fsS http://localhost:3000/ready || exit 1
```

Docker no distingue liveness/readiness — solo hay un check. Para Docker, **readiness** es lo más útil (en Compose, `depends_on: condition: service_healthy` no levanta dependientes hasta que el ready pasa). Si pasas a K8s, configurarás los dos endpoints en `livenessProbe` y `readinessProbe` por separado.

## Lo que vemos al ejercitarlo

Arranca en dev:

```bash
npm run dev
```

Y haz curl con un `X-Request-Id` propio:

```bash
curl -s -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: demo-abc' \
  -d '{"email":"jose@example.com","name":"Jose"}'
```

En el log:

```
[11:10:08.006] INFO: request
    requestId: "demo-abc"          ← lo respetó
    method: "POST"
    path: "/users"
    status: 201
    duration_ms: 3
```

En producción (`NODE_ENV=production`):

```json
{"level":30,"time":1779102625578,"requestId":"demo-abc","method":"POST","path":"/users","status":201,"duration_ms":3,"msg":"request"}
```

Listo para que Grafana/Loki te lo agregue por `requestId`, te dé p50/p95 de latency por path, y alerte si `status >= 500` rate sube.

## Trampas comunes

### 1. Loggear PII

```ts
logger.info({ user: payload }, 'user created'); // ❌ email + password en log
```

Filtra. Pino tiene `redact`:

```ts
pino({ redact: ['user.password', 'user.token', '*.creditCard'] })
```

Bonus senior: ten un **wrapper de logger** que **rechaza** loggear objetos sin sanitizar, en lugar de confiar en quien escribe el código.

### 2. Stack traces filtrados al cliente

```ts
return c.json({ error: err.message }, 500); // ❌ "Connection refused at db.supabase.co:5432"
```

Mensaje genérico siempre. Información detallada **al log**, nunca al cliente.

### 3. Liveness que toca la DB

Ya lo cubrimos. Repítetelo cada vez que escribas un healthcheck.

### 4. Log synchronous en el hot path

`console.log` es síncrono y bloquea el event loop. Bajo carga, mata el throughput. **Pino es async/buffered por defecto**. Si por alguna razón usas `console.*`, hazlo solo en boot/shutdown.

### 5. `mixin` que falla

Si tu `mixin` lanza (`storage.getStore()` no, pero un mixin más complejo sí), **rompe todos los logs**. Mantenlo trivial y defensive.

### 6. AsyncLocalStorage perdido entre eventos

Si haces:

```ts
process.nextTick(() => logger.info('...')); // ✅ contexto propagado
setImmediate(() => logger.info('...'));      // ✅ contexto propagado
emitter.on('event', () => logger.info('...')); // ❌ contexto perdido si el handler se registró antes del run
```

Los listeners se ejecutan en el contexto **donde se emitieron**, no donde se llama `.emit()`. Si fuera del request, no hay contexto. Solución: enlazar el handler con `als.bind(handler)`.

### 7. `HTTPException` para flujo de negocio

```ts
throw new HTTPException(409, { message: 'email taken' }); // 🤔
```

Funciona, pero pierde la ventaja de `Result`: tipos de error explícitos en la firma. **Prefiero `Result` para errores esperados**, y `HTTPException` solo para casos donde tirar una excepción es más limpio (route guards, auth middleware).

### 8. Request ID demasiado largo

Sin la validación, alguien puede mandar `X-Request-Id: <1MB de basura>`. Cada log de ese request lleva el MB. Tu storage de logs llora. **Valida siempre**.

## Lo que NO hicimos (a propósito)

Cada uno merece su propio capítulo:

- **Métricas (Prometheus)**: latency histograms, request counts, error rate. `prom-client` + endpoint `/metrics`.
- **Distributed tracing (OpenTelemetry)**: traceId/spanId propagados HTTP↔DB↔servicios. Para microservicios. Library: `@opentelemetry/sdk-node`.
- **Audit log**: stream separado de "qué hizo qué usuario cuándo". Distinto del log operacional.
- **Alerting**: las reglas en Grafana/Datadog. Out of scope code-wise.
- **Sentry / error tracking**: agregación de errores con context. `@sentry/node` se conecta como handler.

## Ejercicio

1. **Verifica el flow end-to-end**: arranca con `LOG_LEVEL=debug make dev-api`, manda 3 curls con diferentes `X-Request-Id`, comprueba que cada log lleva el suyo. Usa el `X-Request-Id` de la respuesta como ID para hacer un follow-up — el server lo aceptará idempotentemente.

2. **Loggea desde un servicio**: añade un `logger.info({ email: payload.email }, 'creating user')` dentro de `services/user-service.ts`. Pásalo via deps (es decir, cambia la firma a `createUser(deps: { repo, logger }, payload)`). Discute si te gusta pasarlo explícito o si prefieres llamar a `getRequestId()` + un logger del módulo.

3. **Reto — Error structurado de Postgres**: cuando el `INSERT` falla por unique constraint (race condition que evade el `findByEmail` previo), el repo Postgres lanza. Captura el error específico (código `23505` en Postgres) y conviértelo a `Result<never, UserError>` para que el service lo trate como 409 igual que la versión sin race. Pista: el error de `postgres` tiene `err.code === '23505'`.

4. **Reto — Redaction de PII**: configura pino con `redact: ['*.password', '*.email']` y verifica que `logger.info({ user: { email: 'x@y.z', name: 'X' } }, 'ok')` esconde el email en el log. ¿Por qué `*.email` y no `email`?

5. **Reto — `/metrics` con `prom-client`**: añade `prom-client`, exponé `GET /metrics` con counter de requests y histogram de latencias. Lee el output. Cuando hay un Prometheus apuntándote, ¿qué dashboard mínimo levantarías?

6. **Reto — Trace continuation**: si te llega un header `traceparent` (W3C Trace Context), propágalo. Asocia logs a un `traceId` además del `requestId`. Es el siguiente paso natural cuando tienes un segundo servicio HTTP downstream.

7. **Reto — Graceful shutdown con drain**: ahora el `SIGTERM` cierra el server abruptamente. Senior real: rechaza nuevas requests (responde 503 con `Connection: close`), espera ~30s a que las en curso terminen, y solo entonces cierra. Pista: `server.close()` ya hace lo del "no acept new", pero la pieza de 503 es manual.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 33 — *Push Null Values to the Perimeter of Your Types*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/null-values-to-perimeter.md)** — el paradigma "business → Result, infra → throw": los errores se manejan en los bordes (handler, middleware), nunca enmedio.
- **[Item 34 — *Prefer Unions of Interfaces to Interfaces with Unions*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/union-of-interfaces.md)** — `UserError` cuando crezca (`{ kind: 'not_found' } | { kind: 'email_already_taken' } | ...`) es exactly este patrón.
- **[Item 41 — *Name Types Using the Language of Your Problem Domain*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-design/language-of-domain.md)** — los `kind` del error son del dominio (`email_already_taken`), no del transporte (`http_409`).
- **[Item 59 — *Use `never` Types to Perform Exhaustiveness Checking*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-recipes/exhaustiveness.md)** — el `assertNever(x)` en el `switch` del handler. Cuando añades una variante a `UserError`, TS te chilla en el `default` si te dejas un caso.

---

**Anterior:** [11 — Postgres (Supabase) por conexión directa](./11-supabase-postgres.md)
**Siguiente:** [13 — CI/CD con GitHub Actions](./13-ci-cd.md)
