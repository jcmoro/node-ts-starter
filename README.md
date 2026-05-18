# node-ts-starter

> Proyecto de aprendizaje de **TypeScript moderno** 
> para senior backend engineers que vienen de Java, Go, PHP, Python… 
> Un backend real (Hono + Zod + dual SQLite/Postgres) 
> y un mini frontend (Vite + DOM nativo), 
> acompañados de **14 capítulos en español** con los términos técnicos en inglés. 
> Pensado para leer en paralelo a *Effective TypeScript* (Dan Vanderkam, 2ª ed, O'Reilly 2024).

---

## El curso

| # | Capítulo | Qué cubre |
|---|----------|-----------|
| 00 | [Introducción](./docs/00-intro.md) | Para quién es, cómo está organizado, convenciones, mapping con el libro |
| 01 | [Runtime y ESM](./docs/01-runtime-y-esm.md) | Node 22 `--experimental-strip-types`, ESM puro, `verbatimModuleSyntax` |
| 02 | [tsconfig estricto](./docs/02-tsconfig-strict.md) | Cada flag estricto, qué bug previene, analogías Java/Go |
| 03 | [Validación con Zod](./docs/03-validacion-con-zod.md) | El borde del sistema, `parse` vs `safeParse`, env validado |
| 04 | [Result type](./docs/04-result-type.md) | Discriminated unions, narrowing, `never` en helpers |
| 05 | [Testing con `node --test`](./docs/05-testing-node-test.md) | Runner nativo, refactor para testabilidad, `app.request` de Hono |
| 06 | [Branded types](./docs/06-branded-types.md) | Phantom property, smart constructors, Zod brands |
| 07 | [Servicios y repositorios](./docs/07-servicios-y-repositorios.md) | Capas, composition root, fake-over-mock |
| 08 | [Persistencia SQLite](./docs/08-persistencia-sqlite.md) | `node:sqlite`, mapeo filas → tipos branded |
| 09 | [Frontend del curso](./docs/09-frontend-curso.md) | Vite, vanilla DOM tipado, `import.meta.glob` |
| 10 | [Docker y tooling](./docs/10-docker-y-tooling.md) | Multi-stage builds, Biome, Makefile senior |
| 11 | [Postgres (Supabase)](./docs/11-supabase-postgres.md) | Conexión directa, driver `postgres`, migraciones |
| 12 | [Error handling y observabilidad](./docs/12-error-handling-y-observabilidad.md) | pino + AsyncLocalStorage + middleware + liveness/readiness |
| 13 | [CI/CD con GitHub Actions](./docs/13-ci-cd.md) | Quality + images + GHCR releases + Dependabot |
| 14 | [Type-level testing](./docs/14-type-level-testing.md) | `Equal<X,Y>` canónico (Item 55), tests de tipos en `Result` y branded types |
| 15 | [Métricas con Prometheus](./docs/15-metricas-prometheus.md) | `prom-client`, RED method, cardinality discipline, `/metrics`, PromQL |
| 16 | [OpenTelemetry tracing](./docs/16-opentelemetry-tracing.md) | SDK + `--import`, auto-instrumentation, `withSpan`, correlación logs↔traces, sampling |
| 17 | [Stack de observabilidad](./docs/17-observabilidad-stack.md) | Prometheus + Tempo + Grafana en compose, datasources provisionados, exemplars, service graph |

> **Cómo leerlo**: por orden. Cada capítulo asume los anteriores y construye sobre el código que dejaron. Cuando termines el 17, tienes un backend + frontend production-ready con observabilidad completa (logs+métricas+traces) visualizable en Grafana local y entiendes por qué cada decisión.

---

## Quickstart

```bash
# Primera vez
make install

# Desarrollo (dos terminales)
make dev-api                  # backend en :3000
make dev-web                  # frontend en :5173

# Calidad
make check                    # lint + typecheck + tests

# Docker
make up                       # stack producción-like en :3000 + :8080
make up-dev                   # Postgres local + Vite hot reload
make smoke                    # smoke-test del stack arriba

# Ver todos los targets
make help
```

---

## Requisitos

- **Node ≥ 22.6.0** (definido en `.nvmrc`)
- **Docker** + **Docker Compose** para la stack containerizada
- **Make** (pre-instalado en macOS/Linux; en Windows usar WSL)

---

## Stack

| Capa | Tecnología | Por qué |
|------|------------|---------|
| Runtime | Node 22 + `--experimental-strip-types` | TS sin transpilación, ESM nativo |
| HTTP | [Hono](https://hono.dev/) | Web framework moderno, type-safe, ESM-first |
| Validación | [Zod 4](https://zod.dev/) | Schemas que generan tipos y validan en runtime |
| DB | [`node:sqlite`](https://nodejs.org/api/sqlite.html) + [`postgres`](https://github.com/porsager/postgres) | Dual backend (`DATABASE_URL` decide) |
| Tests | [`node:test`](https://nodejs.org/api/test.html) nativo | Cero dependencias |
| Logging | [pino](https://getpino.io/) + `AsyncLocalStorage` | Estructurado, request-context automático |
| Frontend | [Vite](https://vite.dev/) + vanilla DOM + [marked](https://marked.js.org/) | TS puro, sin framework |
| Lint+format | [Biome](https://biomejs.dev/) | Un solo binario (Rust), reemplaza ESLint+Prettier |
| Containers | Docker multi-stage + nginx + tini | Non-root, healthchecks, OCI labels |
| CI/CD | GitHub Actions + GHCR | Cached builds, semver tags, Dependabot |

---

## Estructura del proyecto

```
docs/                      14 capítulos del curso
migrations/                migraciones SQL versionadas
src/                       backend
├── app.ts                 composition root: middleware + handlers
├── index.ts               bootstrap async (logger, health, repo dispatch)
├── env.ts                 env validado con Zod
├── domain/                user.ts (Email, UserId, branded types)
├── lib/                   result.ts, logger.ts (pino), request-context.ts (ALS)
├── db/                    SQLite + Postgres clients, migrate runner, health checks, cli
├── middleware/            request-id, request-logger, error-handler
├── repositories/          UserRepository interface + in-memory/sqlite/postgres impls
└── services/              user-service.ts (createUser con Result<User, UserError>)
web/                       frontend Vite
├── src/                   chapters.ts, markdown.ts, router.ts, main.ts, styles.css
├── index.html
└── vite.config.ts
.github/
├── workflows/             ci.yml, release.yml
└── dependabot.yml
Dockerfile.api, Dockerfile.web, nginx.conf
docker-compose.yml, docker-compose.dev.yml
Makefile, biome.json, .editorconfig, .dockerignore
```

---

## Cross-reference con *Effective TypeScript* (2ª edición)

El libro de Dan Vanderkam tiene un repo oficial con los 83 items, sus "Things to Remember" y todos los code samples:

🔗 **https://github.com/danvk/effective-typescript**

Cada capítulo de este curso tiene al final una sección **📖 Lectura paralela** con los items específicos que lo profundizan. Tabla resumen:

| Capítulo | Items relevantes (2ª ed) |
|----------|--------------------------|
| 01 — Runtime y ESM | 3, 72, 73, 79 |
| 02 — tsconfig estricto | 2, 11, 14, 22, 83 |
| 03 — Validación con Zod | 30, 46, 74, 76 |
| 04 — Result type | 22, 32, 34, 59 |
| 05 — Testing | 55, 77 |
| 06 — Branded types | 4, 35, 41, 64 |
| 07 — Servicios y repositorios | 13, 29, 41, 67 |
| 08 — Persistencia SQLite | 30, 46, 74, 76 |
| 09 — Frontend | 22, 75, 76 |
| 10 — Docker y tooling | 2, 65, 78 |
| 11 — Postgres | 30, 35, 41, 74 |
| 12 — Errores + observabilidad | 33, 34, 41, 59 |
| 13 — CI/CD | 2, 65, 78 |
| 14 — Type-level testing | 50, 55, 56, 77 |
| 15 — Métricas Prometheus | 34, 41, 76, 78 |
| 16 — OpenTelemetry tracing | 27, 33, 41, 76 |
| 17 — Stack observabilidad | 41, 65, 76, 78 |

> Si solo tienes la 1ª edición del libro, busca por nombre del concepto en lugar de número de item — los temas son los mismos, la numeración cambió.

---

## Licencia

MIT. Aprende, copia, adapta.
