# 10 — Docker, Compose, Biome y Makefile

## El problema

Hasta ahora todo se ha ejecutado en tu máquina local. Esto sirve para aprender, pero **rompe** en cuanto:

- Cambias de máquina y olvidas qué `nvm use` toca.
- Otro dev se incorpora y pasa medio día instalando dependencias.
- Quieres desplegar a un servidor: ¿qué Node? ¿qué locale? ¿qué timezone? ¿qué versión de SQLite?
- Tienes que verificar que la app arranca **igual** que en producción.

El objetivo de este capítulo es **encapsular el stack en imágenes inmutables**, orquestarlas con Compose, y poner por delante un **Makefile** que sea el único interfaz que necesites. Senior-level: nada de "depende de la versión de OpenSSL que tengas".

Decisiones que vamos a tomar:

| Pieza               | Elección             | Tradeoff principal                                  |
|---------------------|----------------------|------------------------------------------------------|
| Linter + formatter  | **Biome**            | Único binario, Rust, rapidísimo. Menos plugins que ESLint |
| Build base image    | **node:22-alpine**   | LTS, pequeña (~50 MB). musl libc, ojo con native modules |
| Init system         | **tini**             | PID 1 que reapa zombies y maneja señales            |
| Static server       | **nginx:1.27-alpine**| Battle-tested. Caddy o Bun.serve son alternativas modernas |
| Orchestrator local  | **docker compose**   | Estándar. k8s queda fuera de scope                  |
| Build cache         | **BuildKit `--mount=type=cache`** | Acelera rebuilds de `npm ci` enormemente |
| Persistencia        | **Named volume**     | Sobrevive `down`, se borra con `down -v`            |
| Orquestación local  | **Makefile**         | Universal, sin dependencias. `just` es alternativa moderna |

## Biome — un único binario para lint + format + imports

```bash
make lint        # biome check .
make lint-fix    # biome check --write .
make format      # biome format --write .
```

Biome reemplaza el dúo clásico **ESLint + Prettier** con:

- **Una sola dependencia** (`@biomejs/biome`).
- **Una sola config** (`biome.json`).
- **Rust por debajo**: ~30x más rápido que ESLint en proyectos medianos.
- **Soporte nativo de TS** sin parsers de terceros.

### El `biome.json` clave

```jsonc
{
  "files": {
    "ignore": ["**/node_modules", "**/dist", ".claude", ".idea"]
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "error",  // fuerza `import type` (cap. 02)
        "useExportType": "error",
        "noNonNullAssertion": "warn" // detecta abuso de `!`
      },
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      }
    }
  },
  "overrides": [
    {
      "include": ["**/*.test.ts"],
      "linter": { "rules": { "suspicious": { "noExplicitAny": "off" } } }
    }
  ]
}
```

Tres detalles dignos de senior:

1. **`useImportType` / `useExportType`** — Biome **fuerza** que separes `import type` de `import` (lo que necesitamos para `--experimental-strip-types` del capítulo 01). Esto **es una decisión técnica**, no estética.
2. **`organizeImports: true`** — reordena imports automáticamente cada vez que formateas. Cero diffs de "alguien movió un import".
3. **`overrides` por path** — los tests pueden usar `any` (a veces necesario para mockear). El resto del código no.

### Migración desde ESLint + Prettier

Biome tiene un comando `biome migrate eslint` y `biome migrate prettier` que importa tu config existente. Si llegas a este proyecto desde uno con ESLint, el cambio es de horas, no de días.

### Cuándo NO usar Biome

- Si necesitas **plugins muy específicos** de ESLint (p.ej. `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`). Biome los está incorporando pero todavía no cubre el 100%.
- Si tu equipo ya tiene **inversión histórica fuerte** en config ESLint y no quieres migrar.

Para un proyecto greenfield: **Biome**.

## Docker: imágenes multi-stage

### Backend (`Dockerfile.api`)

```dockerfile
# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache tini curl
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S app -u 1001 -G nodejs && \
    mkdir -p /data && chown -R app:nodejs /data

WORKDIR /app
COPY --chown=app:nodejs --from=deps /app/node_modules ./node_modules
COPY --chown=app:nodejs package.json ./
COPY --chown=app:nodejs src ./src

USER app

ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/users.db
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -fsS http://localhost:3000/health || exit 1

LABEL org.opencontainers.image.title="node-ts-starter-api"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--experimental-strip-types", "--experimental-sqlite", "src/index.ts"]
```

Anatomía senior:

#### Multi-stage

**Stage `deps`**: solo `npm ci --omit=dev` para instalar dependencias de producción. Se ejecuta una sola vez por cambio de `package-lock.json`.

**Stage `runtime`**: copia `node_modules` del stage anterior + el código fuente. **Sin tooling de build**: ni TypeScript, ni Vite, ni nada. La imagen final no contiene `devDependencies`.

Resultado: imagen pequeña (~120 MB) y sin la superficie de ataque de tooling de dev.

#### `--mount=type=cache`

```dockerfile
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
```

BuildKit mantiene un cache persistente del directorio de npm **entre builds**. La primera vez tarda; la segunda, sin cambios en `package-lock.json`, es **instantánea**.

Para activarlo: `# syntax=docker/dockerfile:1.7` en la primera línea + Docker 18.09+. Compose con BuildKit por defecto.

#### Non-root user

```dockerfile
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S app -u 1001 -G nodejs
USER app
```

Docker corre todo como `root` por defecto. **Eso es un agujero de seguridad**: si alguien rompe el binario y ejecuta código, lo hace como root dentro del contenedor. Crear un usuario sin privilegios es **el mínimo de senior**.

#### `tini` como PID 1

Node como PID 1 **no maneja señales bien**: `docker stop` envía `SIGTERM`, Node lo ignora si no tiene handler, Docker espera 10s y manda `SIGKILL`. Resultado: shutdown lento y datos perdidos.

`tini` es un PID 1 minimalista (~10 KB) que reapa zombies y propaga señales. La línea:

```dockerfile
ENTRYPOINT ["/sbin/tini", "--"]
```

Hace que tini sea el proceso 1 y Node sea su hijo.

#### `HEALTHCHECK`

Docker comprueba `/health` cada 30s. Compose puede esperar a `condition: service_healthy` antes de levantar otro servicio que dependa de éste. Resultado: el web no arranca hasta que el api está vivo.

#### `LABEL` con OCI

Los labels [Open Container Initiative](https://github.com/opencontainers/image-spec/blob/main/annotations.md) son metadata estándar. Registries, scanners y dashboards los entienden.

### Frontend (`Dockerfile.web`)

```dockerfile
# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ---------- builder ----------
FROM node:22-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo/web/node_modules ./web/node_modules
COPY web  ./web
COPY docs ./docs       # ← necesario para import.meta.glob
WORKDIR /repo/web
RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/web/dist /usr/share/nginx/html
```

Detalles importantes:

- **Build context = repo root**, no `web/`. Necesario porque Vite (via `import.meta.glob`) lee `../docs/*.md`.
- **Tres stages**: separa `deps` (cacheable) de `builder` (cambia con cada commit) de `runtime` (nginx).
- **La imagen final NO tiene Node**. Solo nginx servir archivos estáticos. ~40 MB.

### `nginx.conf` para SPA

```nginx
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location / {
    try_files $uri $uri/ /index.html;
}
```

- **`/assets/`** lleva nombres con hash (Vite los genera). Cache infinito + `immutable`.
- **`/`** falla a `index.html`. SPA fallback — necesario para History API, gratis para hash routing.
- **`gzip on`** — Vite no comprime; nginx sí.

## `.dockerignore` — más importante de lo que parece

```
node_modules
web/node_modules
.env
*.db
.git
.vscode
```

Sin este archivo, el `docker build` **copia el contexto entero** (incluyendo `node_modules`, `.git`, `dist`) al daemon antes de procesar el `Dockerfile`. Resultado:

- Builds 10-100x más lentos.
- Imágenes potencialmente con secretos (`.env`).
- Cache invalidations por archivos irrelevantes.

`.dockerignore` debería estar **antes** que el Dockerfile en cualquier review.

## `docker-compose.yml` — el orquestador local

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    image: node-ts-starter-api:latest
    restart: unless-stopped
    environment:
      DATABASE_PATH: /data/users.db
    volumes:
      - api-data:/data
    ports:
      - "${API_PORT:-3000}:3000"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:3000/health"]
      interval: 30s
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: "0.5"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  web:
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "${WEB_PORT:-8080}:80"
```

Lo que un senior espera ver:

1. **`restart: unless-stopped`** — el contenedor se levanta solo si crashea. No al reiniciar manualmente.
2. **`depends_on.condition: service_healthy`** — `web` espera a que `api` pase su healthcheck. No solo "está arrancado".
3. **`resources.limits`** — sin esto, un contenedor con leak puede tumbar el host. Senior **siempre** pone límites.
4. **`logging.options.max-size`** — sin esto, los logs JSON pueden crecer a GB. Senior siempre los rota.
5. **`${API_PORT:-3000}`** — el puerto del host es configurable por env. Cero edición de YAML para evitar conflictos.
6. **Named volume `api-data`** — sobrevive `docker compose down`. Solo `down -v` lo borra.

### `docker-compose.dev.yml` — el patrón de override

Compose permite **encadenar archivos**:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

El segundo **modifica** al primero. En el dev override:

```yaml
services:
  api:
    command: ["node", "--watch", "--experimental-strip-types", "src/index.ts"]
    volumes:
      - ./src:/app/src:ro
    environment:
      LOG_LEVEL: debug

  web:
    image: node:22-alpine
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
    volumes:
      - ./web:/repo/web
      - ./docs:/repo/docs:ro
```

Esto sustituye el `nginx` por un `node` corriendo Vite, monta el código fuente como bind mount, y activa `--watch` en el backend. Resultado: **hot reload dentro del contenedor**.

> 💡 **Cuándo usar dev en Docker**: raramente. Dev local es más rápido. El override existe para casos de **paridad con prod**, **CI**, o **onboarding** sin instalar Node.

## El `Makefile` como única interfaz

```bash
make help            # ↑ tu única instrucción a memorizar
```

Output:

```
Usage: make <target>

--- Setup ---
  install              Install all dependencies (api + web).
  install-api          Install backend dependencies.
  install-web          Install frontend dependencies.

--- Local dev (no docker) ---
  dev-api              Run backend dev server with --watch (port 3000).
  dev-web              Run Vite dev server (port 5173).

--- Quality ---
  typecheck            Type-check api + web.
  lint                 Lint with Biome (no writes).
  test                 Run backend test suite.
  check                Run all quality gates (lint + typecheck + tests).

--- Docker ---
  build                Build all images (production).
  up                   Start the production stack in background.
  up-dev               Start the stack with dev overrides.
  down                 Stop the stack (preserves volumes).
  logs                 Tail logs from all services.
  shell-api            Open a shell inside the api container.
  smoke                Smoke-test the running stack.

--- Cleanup ---
  clean                Remove containers + volumes + local images.
```

### Por qué Makefile y no `npm scripts`

- **Multi-paquete**: tenemos `package.json` en root y en `web/`. `npm run` solo ve uno.
- **Multi-tooling**: orquestamos npm, docker compose, curl. Make compone.
- **Universal**: Make está en cualquier máquina Unix. `just` (alternativa moderna en Rust) requiere instalar. Para tooling de proyecto, **Make gana en disponibilidad**.

### El truco del help auto-documentado

```makefile
.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*?## "; printf "\nUsage: make <target>\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } \
	     /^## ?---/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 4) }' \
	     $(MAKEFILE_LIST)
```

Lee el propio Makefile, busca líneas con `target: ## descripción`, las formatea con color. Patrón ampliamente copiado de proyecto en proyecto. **Imprescindible** para Makefiles grandes.

### Flags estrictas

```makefile
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.ONESHELL:
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules
```

- **`-eu -o pipefail`** — falla rápido (como `set -e` en bash). Una línea que devuelva ≠0 aborta el target.
- **`.ONESHELL`** — todas las líneas de un recipe en el mismo shell. Sin esto, `cd foo && ls` deja de funcionar entre líneas.
- **`.DELETE_ON_ERROR`** — si un recipe que genera archivos falla, los borra. Evita estados inconsistentes.
- **`--warn-undefined-variables`** — detecta typos en `$(VAR_NO_EXISTE)`.

Estos cinco son **el dial de "senior" del Makefile**. Sin ellos, los bugs sutiles aparecen.

### Variables de entorno via Makefile

```makefile
API_PORT ?= 3000
WEB_PORT ?= 8080
export API_PORT WEB_PORT
```

`?=` significa "asigna solo si no existe". Permite hacer:

```bash
WEB_PORT=8088 make up    # override puntual
```

Y el `export` los hace visibles a los subprocesos (`docker compose` los lee del entorno).

## Workflow de un día normal

```bash
git pull
make install           # nuevas deps si las hay
make check             # lint + typecheck + test antes de empezar

# Dos terminales:
make dev-api           # terminal A
make dev-web           # terminal B

# ... codeas ...

make check             # antes de commit
git commit
```

Antes de un PR:

```bash
make build             # ¿compilan las imágenes?
make up                # ¿arranca el stack?
make smoke             # ¿responde?
make down              # bajar
```

Si todo eso pasa, tu PR no va a fallar en CI por algo de tooling.

## Lo que NO hicimos (a propósito)

- **CI/CD** (GitHub Actions, GitLab CI). Una pipeline que ejecute `make check && make build` cubre el 80%. Lo dejamos como ejercicio.
- **Secrets management** (Vault, AWS Secrets Manager). Ahora mismo `.env` plano. Producción real necesita secretos cifrados.
- **Image registry** (ECR, GHCR, Docker Hub). Las imágenes están solo en local.
- **k8s / Nomad / ECS**. Compose es para desarrollo y deploys simples (single-host). Multi-node necesita orquestador real.
- **Distroless / scratch images**. `node:alpine` es pequeño. Distroless (`gcr.io/distroless/nodejs`) lo es más pero a costa de no tener shell para debugar.
- **Image scanning** (Trivy, Snyk). Senior real escanea CVEs en cada build.
- **Reproducible builds** (pinning de digests, `npm ci` con integrity). El paso siguiente cuando seguridad pesa más que velocidad.
- **Multi-arch builds** (`buildx` para arm64 + amd64). Útil para deploy en Graviton o tu M-series local.

Cada uno de estos merecería un capítulo entero. No los hacemos aquí para no perder foco en TypeScript.

## Trampas comunes

### 1. Olvidar `.dockerignore`

Build de 5 minutos en lugar de 5 segundos. Síntoma: `=> [internal] load build context` tarda eternidad.

### 2. Levantar el contenedor como root

Funciona pero **es CVE esperando a pasar**. Cualquier RCE en tu app es RCE como root.

### 3. Healthcheck que devuelve 200 siempre

```dockerfile
HEALTHCHECK CMD echo ok
```

Compila, "funciona", pero **no comprueba nada**. El healthcheck debe **ejercitar** el path crítico (acceso a DB, validación de config). Si es `/health` que solo devuelve `200`, valida que el server tira, no que **funciona**.

### 4. `depends_on` sin `condition`

```yaml
depends_on:
  - api
```

Esto solo espera a que el contenedor **arranque**, no a que la app esté lista. La web puede empezar a hacer requests antes de que el api acepte conexiones. Siempre `condition: service_healthy`.

### 5. Bind mount sobreescribiendo `node_modules`

```yaml
volumes:
  - ./web:/repo/web        # ❌ mata el /repo/web/node_modules del contenedor
```

Solución: volume anónimo sobre el directorio interno:

```yaml
volumes:
  - ./web:/repo/web
  - /repo/web/node_modules # ← preserva los node_modules del contenedor
```

### 6. Tabs vs spaces en Makefile

```makefile
target:
    npm test     # ❌ espacios → 'missing separator' críptico
target:
	npm test     # ✅ TAB
```

Make **requiere** tabs en las recipes. `.editorconfig` con `indent_style = tab` para Makefile soluciona.

### 7. Cambiar `package.json` y olvidar regenerar `package-lock.json`

`npm ci` falla en CI/Docker. Siempre commitea ambos juntos.

### 8. `restart: always` en lugar de `unless-stopped`

`always` reinicia incluso después de `docker stop`. Quieres `unless-stopped` para "reinicia solo si crasheó".

## Ejercicio

1. **CI básico**: crea `.github/workflows/ci.yml` que ejecute `make install && make check` en push a `main`. Pista: `node-version: '22'`, `cache: 'npm'`, dos `cache-dependency-path` (root y web).

2. **Reduce el tamaño de la imagen web**: en el capítulo 09 dejamos como ejercicio reducir el bundle de highlight.js. Hazlo y mide el delta del image size con `docker image ls | grep web`.

3. **Multi-arch build**: usa `docker buildx build --platform linux/amd64,linux/arm64 --push -f Dockerfile.api .`. Necesitas configurar `buildx` y un registry. Pista: `docker buildx create --use`.

4. **Image scanning**: instala [Trivy](https://aquasecurity.github.io/trivy/) y ejecuta `trivy image node-ts-starter-api:latest`. ¿Qué CVEs tiene la base? ¿Cómo los mitigarías?

5. **Reto — Migración a tsup**: el `Dockerfile.api` actual depende de `--experimental-strip-types`. Para producción seria, queremos un bundle `dist/index.js` que ejecute con `node` plano. Añade [tsup](https://tsup.egoist.dev/), un script `build`, y un stage `builder` en el Dockerfile que produzca `dist/`. Pista: tsup usa esbuild, soporta ESM, y respeta `external` para no bundlear `node_modules`.

6. **Reto — Secrets management**: el `DATABASE_PATH` está en compose plano. Imagina que mañana necesitas `DATABASE_PASSWORD`. Diseña cómo pasarlo sin commitearlo: ¿`.env` no versionado? ¿Docker secrets? ¿Vault sidecar? Discute tradeoffs.

7. **Reto — Workspaces npm**: convierte el proyecto en un monorepo npm workspaces (`apps/api` + `apps/web` + `packages/shared`). Mueve el tipo `Result` a `packages/shared/result.ts` y úsalo desde ambos paquetes. ¿Qué cambia en los Dockerfiles?

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 2 — *Know Which TypeScript Options You're Using*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-intro/which-ts.md)** — Biome con `useImportType` activado **enforza** que separes `import type`. Esto refleja exactamente la mentalidad de "conoce y respeta tu config".
- **[Item 65 — *Put TypeScript and `@types` in `devDependencies`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/dev-dependencies.md)** — la justificación de `npm ci --omit=dev` en `Dockerfile.api`. La imagen runtime no debe tener tooling de build.
- **[Item 78 — *Pay Attention to Compiler Performance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/performance.md)** — relevante a partir del momento en que CI tarda más de lo aceptable. `skipLibCheck`, `incremental`, `isolatedModules`: todos los tenemos activados por esto.

---

**Anterior:** [09 — Un frontend para el curso](./09-frontend-curso.md)
**Siguiente:** [11 — Postgres (Supabase) por conexión directa](./11-supabase-postgres.md)
