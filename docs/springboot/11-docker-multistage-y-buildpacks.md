# 11 — Docker multi-stage y Cloud Native Buildpacks

## El problema

Tu Spring Boot app tiene que correr **dentro de un contenedor en producción**. Las dudas habituales:

- **¿Qué imagen base?** Hay decenas: `openjdk`, `eclipse-temurin`, `amazoncorretto`, `bellsoft-liberica`, en variantes `alpine`, `slim`, `distroless`. Mal elegida, tu imagen pesa 800MB en lugar de 200MB.
- **¿JDK o JRE en runtime?** El primero ocupa el doble y trae herramientas que no necesitas (`javac`, `jlink`).
- **¿Cómo cachear builds?** Sin caching, cada cambio de una línea recompila Maven entero (~minutos). Con caching, segundos.
- **¿Cómo correr como non-root?** Una imagen de Spring corriendo como root es regalo a un atacante.
- **¿Cómo gestionar señales (Ctrl-C, SIGTERM de k8s)?** La JVM por sí sola no es bueno PID 1.
- **¿Qué pasa con la memoria?** La JVM pre-Java 10 ignoraba los cgroups del contenedor y se comía toda la RAM → OOMKilled.

Spring Boot da tres estrategias para resolver esto:

1. **Dockerfile multi-stage manual** — control total. Lo que tiene el repo en `services/spring-api/Dockerfile`.
2. **Cloud Native Buildpacks** (`mvn spring-boot:build-image`) — sin Dockerfile. Paketo + community defaults sanos.
3. **GraalVM native image** (`mvn spring-boot:build-image -Pnative`) — startup en milisegundos, sin JVM en runtime. Trade-offs serios.

Este doc cubre las tres con foco en la primera (la que ya está implementada).

## Anatomía del Dockerfile multi-stage del repo

```dockerfile
ARG JAVA_VERSION=21

# ---------- build ----------
FROM eclipse-temurin:${JAVA_VERSION}-jdk-alpine AS build

WORKDIR /workspace
RUN apk add --no-cache maven

COPY services/spring-api/pom.xml ./pom.xml
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -DskipTests dependency:go-offline

COPY services/spring-api/src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -DskipTests package && \
    java -Djarmode=layertools -jar target/*.jar extract --destination target/extracted

# ---------- runtime ----------
FROM eclipse-temurin:${JAVA_VERSION}-jre-alpine AS runtime

RUN apk add --no-cache tini wget && \
    addgroup -g 1001 -S spring && \
    adduser -S app -u 1001 -G spring

WORKDIR /app
USER app

COPY --chown=app:spring --from=build /workspace/target/extracted/dependencies/        ./
COPY --chown=app:spring --from=build /workspace/target/extracted/spring-boot-loader/  ./
COPY --chown=app:spring --from=build /workspace/target/extracted/snapshot-dependencies/ ./
COPY --chown=app:spring --from=build /workspace/target/extracted/application/         ./

ENV SPRING_PROFILES_ACTIVE=prod \
    SERVER_PORT=8080 \
    JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget --spider -q http://localhost:8080/actuator/health || exit 1

LABEL org.opencontainers.image.title="node-ts-starter-spring-api" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
```

Vamos a desentrañar cada decisión.

### Multi-stage: separar "qué necesito para compilar" de "qué necesito para correr"

Un Dockerfile con **dos `FROM`** define dos imágenes intermedias. Solo la última (`runtime`) acaba en la imagen final. La primera (`build`) solo existe para producir artefactos que se copian al runtime.

Beneficios:
- **Runtime sin JDK** — la imagen final solo tiene JRE (50% del tamaño).
- **Sin Maven** en runtime — Maven es ~100MB de jars que no necesitas correr.
- **Sin código fuente** ni `target/` con clases intermedias.

Ejemplo concreto: la imagen final de este repo pesa ~180MB. Si metieras todo (JDK + Maven + src + classes), serían ~600MB.

### Cache mounts (BuildKit)

```dockerfile
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -DskipTests dependency:go-offline
```

`--mount=type=cache,target=...` es feature de BuildKit (el builder moderno de Docker). Monta un volumen cacheado **entre builds** en ese path:

- **Sin cache mount**: cada build de Docker borra `/root/.m2`. Maven re-descarga 50–200MB de dependencias.
- **Con cache mount**: BuildKit reutiliza el cache entre builds. Después de la primera vez, descargas casi nada.

Para activarlo necesitas `DOCKER_BUILDKIT=1` (ya está en el `Makefile`). En docker compose con buildkit por defecto, lo aplica automáticamente.

### `COPY pom.xml` antes de `COPY src/`

Una de las decisiones más importantes para velocidad de builds. Docker cachea **layers** por el contenido de los archivos copiados:

```dockerfile
COPY pom.xml ./pom.xml
RUN mvn dependency:go-offline      # ← layer cacheado si pom.xml no cambió

COPY src ./src                      # ← layer cacheado si src/ no cambió
RUN mvn package                     # ← solo se invalida si src/ cambió
```

Si solo tocas un `.java`, **`pom.xml` no cambia → cache hit en la layer de deps**. Ahorra los 30s de Maven resolviendo deps. Si tocas el pom, todo se reconstruye.

**Antipatrón**: `COPY . .` antes de `RUN mvn` — cualquier cambio invalida toda la cache.

### Spring Boot layered jars

Cap. 01 mencionó las layered jars. Aquí brillan:

```dockerfile
java -Djarmode=layertools -jar target/*.jar extract --destination target/extracted
```

Esto descompone el fat jar en **4 capas** ordenadas por tasa de cambio (baja → alta):

```
target/extracted/
├── dependencies/          ← libs de terceros (cambian raro, ej. al subir Spring)
├── spring-boot-loader/    ← el loader que junta todo (casi nunca cambia)
├── snapshot-dependencies/ ← deps SNAPSHOT (cambian cuando trabajas en libs internas)
└── application/           ← TU código (cambia en cada commit)
```

Y luego en el runtime stage:

```dockerfile
COPY --from=build /workspace/target/extracted/dependencies/         ./
COPY --from=build /workspace/target/extracted/spring-boot-loader/   ./
COPY --from=build /workspace/target/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/target/extracted/application/          ./
```

Cada COPY crea su propia **layer Docker**. Si solo cambia `application/`, las tres primeras layers están en cache → push del registry envía solo unos KB. Sin layers, cada commit re-pushea ~80MB.

### Non-root user

```dockerfile
RUN addgroup -g 1001 -S spring && \
    adduser -S app -u 1001 -G spring
USER app
```

Por defecto los containers corren como root. Si un atacante explota la app, ya está en root del container. Aunque container ≠ host, hay rutas de escape (CVEs en runc, montar `/proc` mal). **Siempre** non-root:

- UID/GID >= 1000 (algunos clusters bloquean UIDs bajos).
- Sin home dir extras, sin shell — `-S` (system user).

Y `WORKDIR /app` + `USER app` antes de cualquier copia que haga `--chown=app:spring`.

### tini como PID 1

```dockerfile
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "java ... JarLauncher"]
```

El proceso PID 1 en un container tiene responsabilidades **especiales**:

1. **Reapear zombies**: cuando un child muere, hay que `wait()` para que Linux libere el slot.
2. **Reenviar señales**: SIGTERM debe llegar a la JVM para graceful shutdown.

La JVM **no** hace lo primero bien. Si tu app spawnea subprocesses (raro pero pasa) y mueren, se acumulan zombies hasta que el kernel falla. Y con un shell intermedio, las señales se pierden.

**tini** es un init mínimo (1MB) que hace los dos. Ponerlo como PID 1 es estándar. Alternativa: `dumb-init`.

### `+UseContainerSupport` y `MaxRAMPercentage`

```dockerfile
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
```

Pre-Java 8u191, la JVM **ignoraba** los cgroups del container y leía la RAM total **del host**. Si tu k8s pod tenía 512MB y el host 32GB, la JVM intentaba usar 32GB → OOMKilled.

Desde Java 10:

- **`+UseContainerSupport`** (activo por defecto) — la JVM respeta `mem.limit` del cgroup.
- **`MaxRAMPercentage=75.0`** — usa hasta 75% de la RAM disponible para el heap. El otro 25% es metaspace, threads, JIT, native code. **No** uses 100%.

Para CPU: `-XX:ActiveProcessorCount=N` o dejarlo automático.

### Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget --spider -q http://localhost:8080/actuator/health || exit 1
```

Cuatro parámetros importan:

- **`interval`** — cada 30s comprueba. Más bajo = más overhead.
- **`timeout`** — la check tiene 3s antes de declararse fallida.
- **`start-period`** — durante los primeros 30s, los fallos **no cuentan**. Spring tarda ~3s en arrancar; sin start-period, Docker lo declara unhealthy antes de arrancar.
- **`retries`** — 3 fallos seguidos para marcar unhealthy.

Docker Compose / k8s usan esta info para decidir si reenviar tráfico (readiness) y reiniciar el container (liveness).

### OCI labels

```dockerfile
LABEL org.opencontainers.image.title="..." \
      org.opencontainers.image.licenses="..."
```

Metadata estándar [OCI](https://github.com/opencontainers/image-spec/blob/main/annotations.md). La leen registries (GHCR muestra el title, source, licenses), scanners (Snyk, Trivy), herramientas (docker scout). Cuesta cero ponerlas y aporta señalización.

Labels útiles:

| Label                                      | Para qué                              |
|--------------------------------------------|---------------------------------------|
| `org.opencontainers.image.title`           | Nombre legible                        |
| `org.opencontainers.image.description`     | Descripción corta                     |
| `org.opencontainers.image.version`         | Versión del software (semver)         |
| `org.opencontainers.image.source`          | URL del repo                          |
| `org.opencontainers.image.licenses`        | SPDX expression (`MIT`, `Apache-2.0`) |
| `org.opencontainers.image.revision`        | Git commit SHA                        |
| `org.opencontainers.image.created`         | Build timestamp                       |

## Cloud Native Buildpacks (CNB): sin Dockerfile

Spring Boot 2.3+ integra **Paketo Buildpacks** via `spring-boot:build-image`. Sin Dockerfile, sin decisiones sobre base image, layered jars, security:

```bash
cd services/spring-api
mvn spring-boot:build-image
```

El plugin:

1. Detecta tu Java version (lee `pom.xml`).
2. Elige una base image apropiada (Bellsoft Liberica o Eclipse Temurin).
3. Mete tu app en layers separados (deps, app code, etc.).
4. Configura `JAVA_OPTS` para containers automáticamente.
5. Activa AppCDS (Class Data Sharing) — caché de class loading para arrancar más rápido.
6. Aplica security hardening (non-root, etc.).
7. Publica una imagen con OCI labels estándar.

Resultado: una imagen con sane defaults sin que tú escribas un Dockerfile. La imagen se llama por convención `library/<project-name>:<version>` o lo que pongas en `<image><name>...` del plugin config.

### Cuándo CNB vs Dockerfile manual

| Necesito...                              | Mejor opción         |
|------------------------------------------|----------------------|
| Sane defaults rápido, no quiero pensar   | CNB                  |
| Imagen pequeña al máximo (alpine)        | Dockerfile (Paketo usa Ubuntu base) |
| Base image muy específica (distroless, FIPS) | Dockerfile        |
| Auto-update de base image en builds CI   | CNB                  |
| Imágenes con tooling extra (curl, jq)    | Dockerfile           |
| AppCDS / native sin esfuerzo             | CNB                  |
| Onboarding nuevo desarrollador del equipo | CNB (menos config)  |

Recomendación pragmática: **CNB para servicios nuevos sin necesidades especiales**, Dockerfile **cuando hay un porqué** (base image, multistage exótico, builds binarios extra).

### Conviviendo con un Dockerfile existente

`mvn spring-boot:build-image` **no usa** el Dockerfile. Es un sistema paralelo. Puedes tener los dos en el repo y elegir cuál usar según el entorno (CI vs local, dev vs staging).

## GraalVM native image (preview)

GraalVM permite compilar tu Spring Boot a un **binario nativo** sin JVM. Beneficios:

- **Startup en ms** (vs 2-3s con JVM): perfecto para serverless, scaling rápido.
- **Memoria base ~50MB** (vs ~200MB con JVM).
- **Sin JIT warmup**.

Trade-offs:

- **Build muy lento** (5-15 min).
- **Reflexión requiere hints**: cualquier código que use `Class.forName(...)` o serialization debe registrarse manualmente o vía `@RegisterReflectionForBinding`.
- **No hot-reload**: cada cambio = nuevo build largo. Dev loop sufre.
- **Algunos libs no son compatibles** (las que dependen mucho de runtime introspection).

Cuándo usar:
- Microservicios con startup crítico (Lambdas, scale-to-zero en k8s).
- Apps que necesitan minimizar memoria.
- **No** para dev loop. Build con JVM en dev, compila a native solo en CI/CD.

Para activarlo:

```bash
mvn spring-boot:build-image -Pnative
```

Necesitas el plugin `native-maven-plugin` y `org.springframework.boot:spring-boot-starter-graal-native`. Spring 3 documenta `RuntimeHints` para registrar reflexión donde haga falta.

## Best practices: la lista corta

1. **JRE alpine en runtime** (no JDK, no full Debian).
2. **Multi-stage** para separar build de runtime.
3. **BuildKit cache** para Maven local repo.
4. **Spring Boot layered jars** + COPY por capa.
5. **Non-root user** (UID >= 1000, no shell).
6. **tini** como PID 1.
7. **`+UseContainerSupport` + `MaxRAMPercentage=75`**.
8. **HEALTHCHECK** con `start-period` ajustado a tu tiempo de arranque.
9. **OCI labels** mínimas (title, version, source, licenses).
10. **`.dockerignore`** para excluir `target/`, `.git/`, `*.md` del contexto del build.

## Trampas comunes

1. **JDK en runtime**: imagen 2-3x más grande sin razón. `jre-alpine` ya tiene todo lo necesario para correr (HotSpot, JIT, GC, libs base).

2. **`USER root` por accidente**: si no pones `USER app` (o equivalente) al final del Dockerfile, todo corre como root. Verifica con `docker run --rm spring-api id` — debería decir `uid=1001(app) gid=1001(spring)`.

3. **`COPY . .` antes que `mvn`**: invalida la cache de Maven en cada cambio. Siempre `COPY pom.xml`, `RUN mvn deps`, `COPY src`, `RUN mvn package`.

4. **No usar `--mount=type=cache`**: builds CI tardan minutos descargando Maven Central cada vez. La cache local del builder evita eso. En GitHub Actions, usa `cache-from` y `cache-to` con BuildKit + buildx.

5. **Healthcheck sin `start-period`**: durante el arranque (2-3s), las checks fallan. Sin start-period, Docker marca `unhealthy` en los primeros segundos y orquestadores como ECS o Nomad pueden matar el container antes de que arranque.

6. **`latest` tag en producción**: `eclipse-temurin:latest` puede cambiar inadvertidamente entre builds. **Pinea** la version exacta (`21-jre-alpine`) y actualízala explícitamente con un commit.

7. **No setear `MaxRAMPercentage`**: la JVM por defecto usa 25% del heap del cgroup. Si tu container tiene 512MB asignados, la app solo usa 128MB → GC continuo. Pon `75.0` para alcanzar 384MB de heap.

8. **No tener `.dockerignore`**: el build context incluye `target/` (gigas de class files antiguos), `.git/` (historial), `node_modules/` si los hay. El `COPY . .` los manda al daemon innecesariamente. Crea `.dockerignore`:

   ```
   target/
   .git/
   .idea/
   *.md
   .DS_Store
   ```

9. **Capas mal ordenadas**: en multi-stage, copiar `application/` antes que `dependencies/` invierte la cache. La regla: **las layers menos cambiantes primero**.

10. **JAVA_OPTS sin quotes** en el CMD:
    ```dockerfile
    CMD ["java", "$JAVA_OPTS", "-jar", "..."]   # ❌ exec form no expande variables
    CMD ["sh", "-c", "java $JAVA_OPTS -jar ..."]  # ✅ shell form expande
    ```
    La "exec form" (array) **no procesa variables de entorno**. Si necesitas expansion, usa shell form (`sh -c "..."`).

## Ejercicio

1. **Mira el size de la imagen actual**:
   ```bash
   make build-spring-api
   docker images node-ts-starter-spring-api
   docker history node-ts-starter-spring-api:latest
   ```
   Aprende a leer el `docker history` — verás las layers ordenadas, su tamaño, qué comando las generó. Identifica la layer más grande.

2. **Compara con CNB**:
   ```bash
   cd services/spring-api
   mvn spring-boot:build-image
   docker images | grep node-ts-starter-spring-api
   ```
   `mvn spring-boot:build-image` crea otra imagen. ¿Qué tamaño tiene? ¿Qué base image usa (mira `docker inspect`)?

3. **Verifica non-root**:
   ```bash
   docker run --rm node-ts-starter-spring-api:latest id
   ```
   Debe responder `uid=1001(app) gid=1001(spring) groups=1001(spring)`.

4. **Inspecciona las layers**:
   ```bash
   docker history --no-trunc node-ts-starter-spring-api:latest | head -20
   ```
   Las 4 layers de Spring Boot deberían ser distinguibles (4 COPY consecutivos). Cambia algo trivial en `src/main/java/.../Application.java`, rebuildea, y mira que solo la última layer (de `application/`) se reconstruye.

5. **Añade `.dockerignore`** si no existe:
   ```
   target/
   .git/
   .idea/
   *.md
   .DS_Store
   ```
   Compara el tamaño del build context antes y después con `docker build --progress=plain ...` (verás la transferencia "sending build context").

6. **Tunea JVM para 256MB**:
   ```bash
   docker run --rm -m 256m -p 8080:8080 \
       -e JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=70.0" \
       node-ts-starter-spring-api:latest
   ```
   Verifica con `curl http://localhost:8080/actuator/metrics/jvm.memory.max` que el max heap se respeta el límite.

7. **Reto — GraalVM native**:
   ```bash
   cd services/spring-api
   mvn -Pnative spring-boot:build-image
   ```
   Comprueba el size de la imagen (debería ser ~150MB sin JVM). Mide el tiempo de arranque vs JVM normal. ¿Qué libs sale con warnings de reflection?

## 📖 Lectura paralela

> ⚠️ Esto **no está en el libro** (4ª ed., 2014). Docker existía pero CNB (2018), las layered jars (Boot 2.3, 2020) y GraalVM native (Boot 3.0, 2022) son post-libro.

### Documentación oficial

- [Spring Boot Reference — Container Images](https://docs.spring.io/spring-boot/reference/packaging/container-images/index.html) — el chapter oficial: layered jars, Dockerfile, CNB, native.
- [Spring Boot Reference — Buildpacks](https://docs.spring.io/spring-boot/reference/packaging/container-images/dockerfiles.html) — `mvn spring-boot:build-image` configuración.
- [Paketo Buildpacks Documentation](https://paketo.io/docs/) — los buildpacks que Spring usa por defecto.
- [GraalVM Native Image — Spring Boot](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html) — guide oficial para native compilation.

### Estándares y especificaciones

- [OCI Image Specification — Annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md) — lista completa de labels estándar.
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) — sintaxis completa, incluyendo `--mount=type=cache`.

### Artículos

- [Bret Fisher — Docker Hardening Cheat Sheet](https://github.com/BretFisher/docker-best-practices) — checklist para producción.
- [JVM Anatomy Park — Container Awareness](https://shipilev.net/jvm/anatomy-quarks/12-thread-pool-parallelism/) — Aleksey Shipilev sobre cómo la JVM ve los cgroups.
- [Spring Tips — Buildpacks](https://spring.io/blog/2020/08/14/creating-efficient-docker-images-with-spring-boot-2-3) — la intro oficial de cuando Boot 2.3 integró CNB.

### Herramientas para auditar

- **`docker scout`** — vulnerability scan integrado en Docker CLI.
- **`trivy`** — scanner OSS para imágenes (Snyk, dependabot equivalentes).
- **`dive`** — explorador interactivo de layers; te muestra el waste por capa.

---

**Anterior:** [10 — OpenTelemetry en Spring](./10-opentelemetry.md)
**Siguiente:** [12 — Security básica con Spring Security 6](./12-security.md)
