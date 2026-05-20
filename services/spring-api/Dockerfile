# syntax=docker/dockerfile:1.7
#
# Spring Boot 3.x backend image — Java 21, multi-stage, non-root user.
# Uses Spring Boot's layered jar so Docker can cache dependencies separately
# from application code.
#
# Build context: repository root (so the shared migrations/ directory is
# reachable for tooling consistency, even though Spring-API doesn't run them).

ARG JAVA_VERSION=21

# ---------- build ----------
FROM eclipse-temurin:${JAVA_VERSION}-jdk-alpine AS build

WORKDIR /workspace
RUN apk add --no-cache maven

# Cache deps separately from sources for faster rebuilds.
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

# Copy layers in increasing churn order so the lowest layers cache best.
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
      org.opencontainers.image.description="Spring Boot 3.x backend (Java 21, Postgres)" \
      org.opencontainers.image.source="https://github.com/your/node-ts-starter" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
