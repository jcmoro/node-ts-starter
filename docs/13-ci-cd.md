# 13 — CI/CD con GitHub Actions

## El problema

En el capítulo 10 construimos el `make check` y `make build`. Funcionan **en tu máquina**. Pero un PR de un colaborador, ¿cómo verificas que sus tests pasan? ¿Y que sus imágenes Docker compilan? ¿Y que no rompió la integración con Postgres?

**Manualmente no escala.** Necesitas:

- **CI** (Continuous Integration): cada push y cada PR ejecuta automáticamente lint, typecheck, tests, y build de imágenes.
- **CD** (Continuous Delivery): los tags de versión publican imágenes a un registry, listas para deploy.

Hoy esto se hace con **GitHub Actions** en el 90% de proyectos open-source y muchísimos privados. Es la herramienta que vamos a usar.

## Visión general

Dos workflows separados, una razón por archivo:

| Archivo | Cuándo corre | Qué hace |
|---------|--------------|----------|
| `.github/workflows/ci.yml`      | `push` y `pull_request` | Lint + typecheck + tests (con Postgres) + build de imágenes (sin push) |
| `.github/workflows/release.yml` | tags `v*.*.*` + `workflow_dispatch` | Build + **push** de imágenes a GHCR con tags semánticos |

Plus:

- `.github/dependabot.yml` — auto-PRs semanales para dependencias.

> 💡 **Por qué dos archivos**: el principio "un workflow, un propósito". El CI corre en cada push (rápido, sin side-effects). El release publica (lento, requiere permisos elevados). Mezclarlos da workflows enormes y permisos sobrescaled en runs donde no hace falta.

## `ci.yml` — desmontaje

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Cuatro decisiones de senior nada más empezar:

### `permissions: contents: read`

**Privilege of least.** Por defecto un workflow tiene casi todos los permisos del `GITHUB_TOKEN`. Si tu CI no los necesita (y normalmente no), restringe explícitamente. Los jobs que sí los necesitan (push a GHCR) lo declaran en su propio workflow.

Esto te salva de un supply-chain attack: si una action que ejecutas tiene un compromise, el daño está limitado por los permisos.

### `concurrency`

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Si haces 5 pushes seguidos a una rama de feature, GHA cancela los 4 primeros y solo termina el último. Ahorra runners (minutos limitados en plan gratuito) y feedback rápido. En `main` no cancelamos — cada commit que aterriza debe tener historial completo de CI para auditoría.

### Service container Postgres

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U postgres -d app"
      --health-interval 5s
      --health-timeout 3s
      --health-retries 10
```

GitHub Actions sabe levantar contenedores **como dependencia del job**. Aquí:

- Postgres 16 alpine arranca antes del primer step.
- El healthcheck `pg_isready` espera a que esté listo (los steps no se ejecutan hasta que pase).
- Está accesible como `localhost:5432` desde los steps.

Luego le pasamos a los tests:

```yaml
env:
  TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/app
```

Como en el capítulo 11, `postgres-user-repository.test.ts` checkea `TEST_DATABASE_URL`. En CI está set → **los tests Postgres se ejecutan**. En local sin `db-up`, se skipean. Mismo código, comportamiento adaptado al entorno.

> 💡 **Alternativa**: `testcontainers-node` lanza el contenedor desde el código del test. Más portable (los mismos tests corren en local y en CI sin diferencias de setup), más pesado. Los service containers de GHA son el camino "fácil"; testcontainers el camino "puro". Para senior real-life: ambos tienen su sitio.

### Caching de `npm`

```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: .nvmrc
    cache: npm
    cache-dependency-path: |
      package-lock.json
      web/package-lock.json
```

- **`node-version-file: .nvmrc`** — versión Node viene del repo, no del workflow. Si cambias `.nvmrc`, CI se actualiza solo.
- **`cache: npm`** — descarga deps de la cache si el lock file no cambió. **2 segundos vs 60 segundos** por job.
- **`cache-dependency-path` multi-línea** — tenemos **dos** lock files (root + web). Setup-node los combina en una sola clave de cache.

### Caching de Docker layers

```yaml
- uses: docker/build-push-action@v6
  with:
    context: .
    file: Dockerfile.api
    push: false
    cache-from: type=gha,scope=api
    cache-to: type=gha,scope=api,mode=max
```

`type=gha` exporta/importa las capas BuildKit desde el **cache de GitHub Actions** (el mismo que usa setup-node). `mode=max` cachea **todas** las capas intermedias, no solo el resultado final.

`scope=api` y `scope=web` separan los caches — sin esto, los dos builds se pisan y rebuilds innecesarios.

Resultado: el segundo run que solo cambia el README rebuilds las imágenes en ~10 segundos. Sin cache: 2+ minutos.

## `release.yml` — desmontaje

```yaml
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:

permissions:
  contents: read
  packages: write
```

- **Trigger por tag**: el flujo típico es `git tag v1.2.3 && git push --tags`. Eso dispara el release.
- **`workflow_dispatch`**: permite lanzarlo manualmente desde la UI. Útil para republicar la última versión sin crear un tag nuevo.
- **`packages: write`**: el permiso mínimo para push a GHCR.

### Login a GHCR

```yaml
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

GHCR (GitHub Container Registry) está pegado a tu repo. **Cero setup**: el `GITHUB_TOKEN` integrado tiene permiso (porque lo declaraste arriba) y `${{ github.actor }}` es el usuario que disparó el run.

### Tags semánticos via `metadata-action`

```yaml
- id: meta-api
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/${{ github.repository }}/api
    tags: |
      type=ref,event=tag
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=semver,pattern={{major}}
      type=sha,prefix=sha-,format=short
      type=raw,value=latest,enable={{is_default_branch}}
```

Para un tag `v1.2.3`, genera estas tags de imagen automáticamente:

- `v1.2.3` (literal del tag)
- `1.2.3` (semver completo)
- `1.2` (semver minor — pin a "última patch de 1.2")
- `1` (semver major — pin a "última 1.x")
- `sha-a1b2c3d` (commit SHA — reproducible)
- `latest` (solo si estamos en `main`)

Esto es el **patrón canónico**. Un usuario puede hacer `docker pull ghcr.io/jose/api:1` para fijar major y recibir patches automáticamente. O `docker pull ghcr.io/jose/api:sha-a1b2c3d` para versión exacta inmutable.

> 💡 **Por qué `latest` solo en `main`**: si publicas `latest` desde una rama feature, sobrescribes la imagen estable. `metadata-action` con `{{is_default_branch}}` evita la trampa.

## `dependabot.yml`

Update automático de dependencias. Cuatro ecosistemas distintos:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday, time: '08:00', timezone: Europe/Madrid }
    groups:
      types:
        patterns: ['@types/*']
      production:
        dependency-type: production
  # ... web npm, github-actions, docker
```

Tres detalles:

- **Cuatro ecosistemas**: npm root + npm web + GitHub Actions (versiones de acciones en los `.yml`) + Docker (`node:22-alpine`, `nginx:1.27-alpine`, etc).
- **`groups`**: agrupa PRs relacionados. Sin esto, recibes 15 PRs cada lunes; con esto, 1 PR de `@types/*`, 1 de production deps, etc.
- **`timezone`**: importa para "weekly". Sin timezone, dependabot dispara a las 00:00 UTC = madrugada en España, los PRs llegan los lunes a las 2am.

## `make ci` — reproduce el CI en local

```makefile
.PHONY: ci ci-web-build
ci: check ci-web-build build

ci-web-build:
	cd web && npm run build
```

Ejecuta lo mismo que CI (sin el postgres service, a menos que tengas `make db-up` primero):

```bash
make install     # deps si no las tienes
make db-up       # opcional, para postgres tests
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/app make ci
make db-down
```

Si esto pasa, **CI debería pasar también**. El día que falla CI y no consigues reproducir, normalmente es un problema de cache de Docker o versión exacta de Node. Mira la salida de CI.

## Tradeoffs y decisiones senior

### Pinear actions a SHA vs tag

Lo que usamos:

```yaml
- uses: actions/checkout@v4
```

`@v4` es un tag. Si el maintainer hace force-push del tag (raro pero ha pasado), o si una versión menor introduce malware, CI lo ejecuta sin avisar.

**Más seguro**:

```yaml
- uses: actions/checkout@8f4b7f84864484a7bf31766abe9204da3cbe65b3  # v4.2.0
```

Pinea al SHA exacto. Dependabot puede actualizar SHA + comentario para que sepas qué versión usas.

**Tradeoff**: SHAs son ilegibles, mantenerlos manualmente es tedioso. Para senior: SHA en proyectos críticos, `@v4` en proyectos pequeños/aprendizaje. Dependabot lo automatiza.

### Matrix testing

Podríamos correr el quality job en Node 22 + Node 24 (cuando salga LTS):

```yaml
strategy:
  matrix:
    node: [22, 24]
```

**No lo hacemos** porque declaramos `engines.node: ">=22.6.0"`. Si soportamos múltiples versiones, sí: matrix. Si soportamos una, no.

### Multi-arch images

```bash
docker buildx build --platform linux/amd64,linux/arm64 ...
```

Esto produce imágenes que funcionan en Intel/AMD **y** en ARM (Graviton, Apple Silicon). En `release.yml` añadirías:

```yaml
- uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
```

**No lo hacemos por defecto** porque dobla el tiempo de build y la mayoría de hostings son amd64. Activar cuando deploy a Graviton o Cloud Run con cpu=arm64.

### Image signing (Cosign)

```bash
cosign sign ghcr.io/jose/api:v1.2.3
```

Firma criptográfica de la imagen. Verificable en deploy. **Lo correcto para producción seria** (supply-chain security). No lo añadimos porque suma un capítulo entero — Cosign + keyless OIDC + verification policies. Mencionado como ejercicio.

### Security scanning

```yaml
- uses: aquasecurity/trivy-action@0.20.0
  with:
    image-ref: node-ts-starter-api:ci
```

Trivy escanea CVEs en la imagen. Te avisa de "node:22-alpine tiene una vulnerabilidad en libssl". Senior real lo añade al CI y falla el job si encuentra HIGH/CRITICAL. Ejercicio.

## Lo que NO hicimos (a propósito)

- **Deploy automático**: el CD termina al subir la imagen. El deploy (k8s, Fly.io, ECS, Cloud Run) depende del target — cada uno tiene su `argocd-sync`, `flyctl deploy`, `gcloud run deploy`. Out of scope.
- **Secrets management**: para deploy real necesitas secrets (DB password de Supabase, API keys). En GHA se ponen via `secrets.MY_SECRET` con scope a workflow/env. Capítulo entero por sí mismo (Doppler, 1Password CLI, Vault, AWS Secrets Manager…).
- **Preview environments**: deploy automático por PR a un subdominio temporal. Patrón estrella de Vercel/Netlify. Para backend, herramientas como Coolify, Northflank, Fly Machines API.
- **Auto-merge de dependabot**: con CI verde, los PRs de patch versions podrían auto-mergearse. Action: `peter-evans/enable-pull-request-automerge@v3`.
- **Release notes automáticas**: `release-please` o `changesets` generan changelog + bump de versión a partir de los commits.

## Branch protection (no es código, pero hay que decirlo)

GitHub Actions corre los workflows. **Branch protection** los hace **obligatorios** para mergear. Configuración en `Settings → Branches → main → Branch protection rules`:

- ✅ Require pull request reviews (1 mínimo)
- ✅ Require status checks to pass before merging
  - `CI / Lint, typecheck, tests`
  - `CI / Build images (no push)`
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ❌ Require linear history (debatible — prefiero squash merges)
- ✅ Do not allow bypassing the above settings (incluye admins)

Sin esto, alguien con write puede mergear con CI rojo. El CI es solo un semáforo; branch protection es lo que **bloquea** la puerta.

## Trampas comunes

### 1. `GITHUB_TOKEN` con scope inflado por defecto

Sin `permissions:` en el workflow, GHA usa los defaults del repo (que varían). Declara explícitamente `permissions: contents: read`. Senior baseline.

### 2. Actions de terceros sin pinning

```yaml
- uses: random-vendor/random-action@master
```

`@master` = "lo que sea esté hoy". Una mañana introducen un keylogger en master, tu CI lo ejecuta con `GITHUB_TOKEN` accesible. Usa tags pineados, idealmente SHA.

### 3. `secrets.*` accesibles desde forks

Las PRs desde forks **no** tienen acceso a secrets por defecto (correcto). Pero si añades `pull_request_target` (no `pull_request`), sí. **`pull_request_target` con checkout del PR es supply-chain attack listo**. Casi nunca lo necesitas.

### 4. CI lento → desarrolladores ignoran

Si tu CI tarda 15 minutos, la gente mergea sin esperar. Mata el propósito. Métricas para vigilar:

- p95 de duración del job de quality < 5 minutos.
- Cache hit rate > 80%.
- Tests más lentos (top 5) identificados.

### 5. Tests flaky

Un test que falla "a veces" destruye la confianza en CI. La gente empieza a re-runear hasta que pase. **Solución**: detectar (los logs de GH actions tienen "Re-run all jobs" rate) y arreglar. Cero tolerancia.

### 6. Costos en plan gratuito

GitHub gratis: 2000 minutos/mes para repos privados (gratis ilimitado para públicos). Cada push usa minutos. Cancel-in-progress (que ya tenemos) ayuda. Para proyectos personales basta.

### 7. Build de Docker sin BuildKit cache

Sin `cache-from`/`cache-to: type=gha`, cada CI run rebuilds todas las capas. 3 minutos extras por job. Configúralo desde el día 1.

### 8. Compose down en CI (que nunca arrancó)

Tentación: `docker compose up && tests && docker compose down`. **No** — usa los `services:` containers nativos de GHA. Más rápido, healthchecks built-in, menos magic.

## Verificación local

Antes de hacer push y rezar, ejecuta:

```bash
make install
make db-up                # opcional para postgres tests
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/app make ci
make db-down
```

Si esto pasa, CI también pasará (salvo bugs específicos de GHA runners, raros).

Para validar la sintaxis del workflow sin push, dos opciones:

```bash
# Opción 1: actionlint vía Docker (recomendado)
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color

# Opción 2: act — ejecuta los workflows localmente
brew install act
act -j quality   # corre el job quality
```

`act` es **muy útil** para debug. Tiene sus limitaciones (no soporta todas las features de GHA), pero permite iterar sin push-push-push.

## Ejercicio

1. **Sube el proyecto a GitHub** (si no lo tienes ya). Comprueba que `ci.yml` corre en el primer push y que los dos jobs pasan verde. Mira los logs — observa los tiempos sin cache vs con cache.

2. **Configura branch protection**: actívalo en Settings → Branches. Intenta mergear un PR con CI rojo. Confirma que GitHub lo impide.

3. **Crea un tag y observa el release**: `git tag v0.1.0 && git push --tags`. Comprueba que `release.yml` se dispara, las imágenes aparecen en `https://github.com/<tu-usuario>/<repo>/pkgs/container/...`, y los tags semver están como esperabas.

4. **Pull de tu propia imagen**:
   ```bash
   docker pull ghcr.io/<tu-usuario>/node-ts-starter/api:0.1.0
   docker run --rm -e DATABASE_PATH=:memory: -p 3000:3000 ghcr.io/<tu-usuario>/node-ts-starter/api:0.1.0
   curl http://localhost:3000/health
   ```

5. **Activa Dependabot security alerts** (Settings → Code security and analysis). Es ortogonal a `dependabot.yml` (que es para updates rutinarios); estas alertas son para CVEs.

6. **Reto — Image signing con cosign**:
   ```bash
   - uses: sigstore/cosign-installer@v3
   - run: cosign sign --yes ghcr.io/${{ github.repository }}/api@${{ steps.build.outputs.digest }}
   ```
   Sin keys (keyless OIDC). Verifica con `cosign verify ...`.

7. **Reto — Trivy security scanning**:
   ```yaml
   - uses: aquasecurity/trivy-action@0.20.0
     with:
       image-ref: node-ts-starter-api:ci
       format: sarif
       output: trivy-results.sarif
   - uses: github/codeql-action/upload-sarif@v3
     with:
       sarif_file: trivy-results.sarif
   ```
   Las vulnerabilidades aparecen en la pestaña "Security" del repo.

8. **Reto — Deploy a Fly.io**: añade un workflow `deploy.yml` que en push a `main` haga `flyctl deploy`. Necesitas `secrets.FLY_API_TOKEN`. Sigue [fly.io/docs/launch/continuous-deployment-with-github-actions](https://fly.io/docs/launch/continuous-deployment-with-github-actions/).

9. **Reto — auto-merge de Dependabot**: cuando el PR es de patch (`semver-patch`), CI verde, auto-mergea. Pista: [enable-pull-request-automerge](https://github.com/peter-evans/enable-pull-request-automerge).

10. **Reto — Multi-arch**: añade `platforms: linux/amd64,linux/arm64` al `release.yml`. Mide el delta de tiempo. ¿Vale la pena para tu hosting target?

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 2 — *Know Which TypeScript Options You're Using*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-intro/which-ts.md)** — el CI ejecuta `tsc --noEmit` con **el mismo** `tsconfig.json` que tú. La única manera de detectar "compila en mi máquina pero no en CI" es asegurarte de que tu config está pineada y compartida.
- **[Item 65 — *Put TypeScript and `@types` in `devDependencies`*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-declarations/dev-dependencies.md)** — en el workflow, `npm ci` los instala. En el `Dockerfile.api` de producción, `npm ci --omit=dev` los deja fuera. Misma regla, dos contextos.
- **[Item 78 — *Pay Attention to Compiler Performance*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/performance.md)** — la métrica clave de CI es p95 de duración. El día que tu `tsc --noEmit` tarde 30s en lugar de 3, la gente empieza a saltarse checks. `skipLibCheck`, caches de npm/Docker, `--incremental` (no lo usamos aún) son sus herramientas.

---

**Anterior:** [12 — Error handling estructurado y observabilidad](./12-error-handling-y-observabilidad.md)
**Siguiente:** [14 — Type-level testing](./14-type-level-testing.md)
