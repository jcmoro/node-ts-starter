# 01 — Setup: Maven, Boot 3, Java 21, project layout

## El problema

En Java "tradicional" (pre-Boot), arrancar un backend HTTP era: descargar Tomcat, configurar `web.xml`, empaquetar un WAR, deployar, rezar. Spring 4 ayudó (XML config, anotaciones, contenedor IoC), pero seguía pidiendo que orquestaras tú el servidor — la app se desplegaba sobre un container externo y el ciclo de cambios era lento.

**Spring Boot** es la respuesta a esa fricción: un meta-framework sobre Spring que aporta:

1. **Auto-configuración**: si detecta `spring-web` en el classpath, monta un Tomcat embebido. Si detecta `spring-data-jpa`, te da un `EntityManager`. Defaults sensatos para todo.
2. **Starters**: dependencias "todo en uno". `spring-boot-starter-web` arrastra Spring MVC + Jackson + Tomcat + Validation, todo con versiones compatibles.
3. **Convention over configuration**: si pones un `application.yml`, Spring lo carga. Si pones una clase con `@RestController`, la registra. No declaras lo obvio.
4. **Empaquetado**: `mvn package` produce un **fat jar** ejecutable con `java -jar` — sin servidor de aplicaciones, sin WAR, sin nada.

Este capítulo cubre el setup que **ya está hecho** en `services/spring-api/`: por qué cada pieza está, qué la conecta con la otra, y qué patrones del libro (*Spring in Action*, 2014) hay que actualizar.

## La pieza central: `pom.xml`

Maven es el build system + dependency manager. Su archivo de manifiesto es `pom.xml` (Project Object Model). Veamos el nuestro (`services/spring-api/pom.xml`) por bloques.

### Bloque 1 — parent

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.1</version>
    <relativePath/>
</parent>
```

El **parent** es lo más importante del pom. `spring-boot-starter-parent` define un **BOM** (Bill of Materials): cientos de versiones compatibles entre sí. Cuando declaras `spring-boot-starter-web`, no pones versión — Maven la toma del parent.

> 💡 **Por qué un BOM**: en proyectos grandes, gestionar manualmente las versiones de Spring + Jackson + Tomcat + Hibernate + Jakarta APIs es un infierno de incompatibilidades. El BOM lo resuelve declarativamente: "todas estas libs van juntas y han sido probadas en esta combinación".

`<relativePath/>` (vacío) le dice a Maven: "no busques el parent en mi disco; sácalo del repositorio Maven Central".

### Bloque 2 — coordenadas

```xml
<groupId>com.josemoro</groupId>
<artifactId>node-ts-starter-spring-api</artifactId>
<version>0.1.0</version>
```

Las **coordenadas Maven** identifican únicamente este artifact:

- **groupId**: el "namespace", por convención el dominio invertido (`com.josemoro`).
- **artifactId**: el nombre del proyecto.
- **version**: la versión.

Sin `groupId` el namespace global no existiría — todos los proyectos `node-ts-starter-spring-api` colisionarían.

### Bloque 3 — propiedades

```xml
<properties>
    <java.version>21</java.version>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
</properties>
```

`java.version=21` no es una propiedad arbitraria — el `spring-boot-starter-parent` la usa internamente para configurar el `maven-compiler-plugin`. **Esa es la línea que controla con qué Java compilamos**.

> 💡 **Trampa clásica**: tener Java 21 en PATH pero `JAVA_HOME` apuntando a Java 17. Maven usa `JAVA_HOME`, no el `PATH`. Verifica con `mvn -version` (mira "Java version").

### Bloque 4 — starters

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    ...
</dependencies>
```

Cada **starter** trae un grupo coherente de dependencias. Si quieres ver qué arrastra `spring-boot-starter-web`, corre:

```bash
mvn dependency:tree | grep -A 30 starter-web
```

Verás Spring MVC, Tomcat, Jackson, Validation, Logging, etc. **No piensas en versiones**: el BOM las fija.

Lo que cada starter aporta al proyecto:

| Starter                          | Qué te da                                                |
|----------------------------------|----------------------------------------------------------|
| `spring-boot-starter-web`        | Spring MVC + Tomcat embebido + Jackson (JSON)            |
| `spring-boot-starter-validation` | jakarta.validation (`@Valid`, `@NotBlank`, `@Email`...) |
| `spring-boot-starter-data-jpa`   | Spring Data JPA + Hibernate + HikariCP (pool de conexiones) |
| `spring-boot-starter-actuator`   | Endpoints de observabilidad (`/actuator/health`, `/actuator/prometheus`...) |
| `spring-boot-starter-test`       | JUnit 5 + Mockito + AssertJ + MockMvc                    |
| `spring-boot-testcontainers`     | Soporte de Testcontainers para integración con `@ServiceConnection` |

### Bloque 5 — el plugin de Spring Boot

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-maven-plugin</artifactId>
            <configuration>
                <layers>
                    <enabled>true</enabled>
                </layers>
            </configuration>
        </plugin>
    </plugins>
</build>
```

Este plugin hace tres cosas:

1. **`mvn spring-boot:run`** — arranca la app sin empaquetar (dev loop).
2. **`mvn package`** — produce un **fat jar** con todas las deps dentro, ejecutable con `java -jar target/*.jar`.
3. **Layered jars** (con `<layers enabled>`) — el jar se estructura en capas (dependencies, snapshot-dependencies, spring-boot-loader, application) para que Docker pueda cachear cada capa por separado.

Esta última es la que aprovecha el `Dockerfile` con `java -Djarmode=layertools -jar target/*.jar extract` — fundamental para builds Docker rápidos en CI.

## La clase de arranque: `Application.java`

```java
package com.josemoro.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Cuatro líneas que disparan **todo**. Veamos qué hay debajo.

### `@SpringBootApplication`

Es un **meta-annotation**, equivalente a poner tres juntas:

```java
@Configuration              // esta clase contribuye @Bean methods al contexto
@EnableAutoConfiguration    // activa la auto-config basada en classpath
@ComponentScan              // escanea componentes desde este paquete hacia abajo
```

La regla práctica más importante: el **`@ComponentScan`** empieza en el paquete donde está `Application.java`. Cualquier clase con `@Component`, `@Service`, `@Repository`, `@Controller` dentro de `com.josemoro.api.*` se registra automáticamente como bean.

> 💡 **Por qué `Application.java` vive en el package raíz**: si la pusieras en `com.josemoro.api.bootstrap`, el `@ComponentScan` solo escanearía `com.josemoro.api.bootstrap.*` y no vería los controllers. Convención: **siempre** en el package más alto.

### `SpringApplication.run(...)`

Esto:

1. Crea el **ApplicationContext** (el contenedor de DI).
2. Activa todas las auto-configuraciones aplicables (Tomcat embebido, DataSource, EntityManagerFactory, ObjectMapper, etc.).
3. Escanea componentes y los registra como beans.
4. Resuelve dependencias entre beans (inyección).
5. Arranca el servidor embebido (Tomcat por defecto, en `:8080`).

> 💡 **Boot vs Spring "puro"**: en Spring 4 sin Boot, todo esto lo hacías a mano: crear un `AnnotationConfigApplicationContext`, registrar `@Configuration` classes, instanciar un `Server` (Tomcat / Jetty), bindearlo, conectar el dispatcher servlet... eran 50–100 líneas de bootstrap. Boot las reduce a `SpringApplication.run`.

### Tiempos de arranque

Spring Boot 3 con Java 21 arranca rápido para Spring estándar — ~2.5s en hardware moderno. Razones del coste:

- JVM warmup (HotSpot JIT calentando).
- Reflexión para registrar beans.
- Auto-config evalúa muchas reglas.

Para producción no importa (es one-shot al arrancar). Para dev loop, hay `spring-boot-devtools` que reinicia rápido al detectar cambios en classpath, y para casos extremos GraalVM native image baja el arranque a milisegundos (a cambio de un build mucho más lento).

## Configuración: `application.yml` y profiles

Spring lee la configuración desde múltiples fuentes con un **orden de precedencia** (de mayor a menor):

1. Argumentos CLI (`--server.port=9000`).
2. `SPRING_APPLICATION_JSON` (JSON inline).
3. Variables de entorno (`SERVER_PORT`).
4. `application-{profile}.yml` activos.
5. `application.yml` (base).
6. Defaults en código (`@Value("${...:default}")`).

Nuestro `application.yml` (base):

```yaml
spring:
  application:
    name: node-ts-starter-spring-api
  jpa:
    open-in-view: false
    hibernate:
      ddl-auto: none
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect

server:
  port: ${SERVER_PORT:8080}
  shutdown: graceful

management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
```

Dos cosas a destacar:

- **`${SERVER_PORT:8080}`** — placeholder resuelto desde env vars con default. Igual que Bash. Esto es lo que permite arrancar Spring en otro puerto si el 8080 está ocupado: `--server.port=8082` o `SERVER_PORT=8082 mvn spring-boot:run`.
- **`ddl-auto: none`** — Hibernate **no toca** el schema. La gestión del schema es responsabilidad del runner de migraciones SQL del repo. Un perfil de test puede sobreescribir esto a `create-drop` (lo veremos en el cap. 06).

### Profiles

`application-dev.yml`, `application-prod.yml` se cargan SI el perfil correspondiente está activo:

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=dev
# o:
SPRING_PROFILES_ACTIVE=dev java -jar target/*.jar
```

El `dev` apunta al Postgres local; el `prod` exige `SPRING_DATASOURCE_URL` del entorno. Spring soporta múltiples perfiles activos a la vez (`profiles=dev,debug`) y los aplica en orden, así que los más específicos pueden sobreescribir a los más generales.

### `@ConfigurationProperties` (preview del cap. 08)

Para tipar la configuración:

```java
@ConfigurationProperties(prefix = "app.users")
public record UsersConfig(int defaultPageSize, boolean allowSelfRegistration) {}
```

Spring inyecta los valores desde `application.yml`:

```yaml
app:
  users:
    default-page-size: 50
    allow-self-registration: false
```

Lo veremos a fondo en el cap. 08. La idea clave: tu código nunca lee `application.yml` directamente — recibe un objeto **inmutable y tipado** vía inyección.

## Project layout: la convención Maven

```
services/spring-api/
├── pom.xml
├── src/
│   ├── main/
│   │   ├── java/                           ← código de producción
│   │   │   └── com/josemoro/api/
│   │   │       ├── Application.java
│   │   │       ├── health/HealthController.java
│   │   │       └── users/
│   │   │           ├── User.java
│   │   │           ├── UserController.java
│   │   │           ├── UserService.java
│   │   │           ├── UserRepository.java
│   │   │           └── CreateUserRequest.java
│   │   └── resources/                      ← config, templates, statics
│   │       ├── application.yml
│   │       ├── application-dev.yml
│   │       └── application-prod.yml
│   └── test/
│       ├── java/                           ← código de tests
│       │   └── com/josemoro/api/
│       │       └── ApplicationTests.java
│       └── resources/                      ← config de tests
└── target/                                 ← output del build, gitignored
```

**Esto es convención Maven, no decisión nuestra**. Si pusieras código de tests en `src/main/test-extras/`, no se ejecutaría como tal. Maven scanea solo `src/main/*` y `src/test/*`.

Decisiones a notar:

- **Separación estricta `main/` vs `test/`**: lo exige Maven y Java por dos razones — los tests no deben empaquetarse en el fat jar de producción, y dependencias `<scope>test</scope>` (JUnit, AssertJ, Mockito) solo están disponibles para `src/test/`.
- **`resources/` aparte de `java/`**: los archivos no-Java (yamls, properties, sql, templates) se cargan vía `ClassLoader.getResource()` desde el classpath. Maven los copia al jar.
- **`target/` gitignored**: es regenerable. Si lo borras (`mvn clean`), el siguiente build lo reconstruye.

## Trampas comunes

1. **`JAVA_HOME` apuntando a otra versión**:
   ```bash
   java -version   # 21
   mvn -version    # "Java version: 17"  ← !
   ```
   Maven respeta `JAVA_HOME`, no el primer `java` en `PATH`. Síntoma: errores tipo "release version 21 not supported" al compilar. Fix: `export JAVA_HOME=$(/usr/libexec/java_home -v 21)`.

2. **`@SpringBootApplication` en el package equivocado**:
   Si la mueves a un sub-package, `@ComponentScan` deja de ver los controllers. Síntoma: app arranca pero no hay endpoints (404 en todo). Fix: `Application.java` vive en el package raíz.

3. **Mezclar `@Component` con instanciación manual**:
   ```java
   @Service
   public class UserService { ... }

   // En otro sitio:
   var s = new UserService(repository); // ❌ esto NO está en el contexto
   ```
   La instancia que tú creas a mano **no es** un bean. No tiene injection, no se intercepta para transactions, no aparece en `@Autowired`. Si Spring gestiona un tipo, **siempre** pídeselo al contexto (constructor injection es lo idiomático).

4. **Olvidar el `parent` o usarlo sin `relativePath`**:
   Sin parent, Maven no sabe versiones de las starters → "Could not find artifact spring-boot-starter-web:jar:". Pon siempre el parent (`<parent>`) en proyectos Boot.

5. **`mvn install` vs `mvn package`**:
   - `mvn package` → compila + tests + empaqueta en `target/*.jar`.
   - `mvn install` → todo lo anterior + **copia el jar al cache local** (`~/.m2/repository`). Útil si otro módulo del repo depende de este. Para un proyecto único, `package` basta.

6. **Cache local corrupta**:
   A veces (raro pero pasa) un download falla a medias y queda corrupto en `~/.m2`. Síntoma: errores tipo "invalid LOC header" o "could not find class". Fix: borra el directorio del artefacto problemático (`rm -rf ~/.m2/repository/org/springframework/...`) y `mvn dependency:resolve` lo redescarga.

## Ejercicio

1. **Ver el grafo de dependencias**:
   ```bash
   cd services/spring-api
   mvn dependency:tree -Dincludes=org.springframework.boot
   ```
   Cuenta cuántas libs trae `spring-boot-starter-web`.

2. **Romper Java a propósito**:
   Cambia `<java.version>21</java.version>` a `<java.version>22</java.version>` en `pom.xml`. Corre `mvn compile`. ¿Qué error sale? Vuélvelo a `21`.

3. **Arrancar con perfil + propiedad inline**:
   ```bash
   mvn spring-boot:run \
       -Dspring-boot.run.profiles=dev \
       -Dspring-boot.run.arguments="--server.port=9000 --logging.level.org.hibernate.SQL=DEBUG"
   ```
   Observa los SQL emitidos en los logs cuando hagas un POST `/users`.

4. **Listar beans del contexto**:
   Añade temporalmente al `application.yml`:
   ```yaml
   management:
     endpoints:
       web:
         exposure:
           include: health,info,prometheus,beans
   ```
   Arranca y haz `curl http://localhost:8080/actuator/beans`. Verás todos los beans gestionados — `userController`, `userService`, `userRepository`, y centenares más de Spring. Quítalo después; expone demasiado para producción.

5. **Layered jar**:
   ```bash
   mvn package -DskipTests
   jar tf target/node-ts-starter-spring-api-0.1.0.jar | head -30
   ```
   Mira cómo el fat jar está estructurado. Es lo que el Dockerfile multi-stage aprovecha.

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014) — qué leer y qué saltar

- **Capítulo 1 — *Springing into action*** — lee la sección "Application context" y "Beans". Salta XML config y `@ImportResource` (legacy).
- **Capítulo 2 — *Wiring beans*** — solo la parte de `@Autowired` y `@Configuration`. Salta la inyección por setter y el XML.

> ⚠️ **El libro NO cubre Spring Boot 2.x ni 3.x.** Toda la parte de auto-configuración, starters, profiles, y Actuator que ves aquí es **posterior** al libro. Para esos temas, usa la doc oficial.

### Documentación oficial (lo que importa)

- [Spring Boot Reference — Getting Started](https://docs.spring.io/spring-boot/reference/getting-started.html) — 20 min, mejor que leer 4 capítulos del libro.
- [Spring Boot Reference — Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html) — orden de precedencia de propiedades, profiles, `@ConfigurationProperties`.
- [Spring Framework Reference — Core](https://docs.spring.io/spring-framework/reference/core.html) — el IoC container con detalle (lo veremos en cap. 02).

---

**Anterior:** [00 — Introducción al track Spring Boot](./00-intro.md)
**Siguiente:** [02 — DI y beans: IoC container, autowiring, scopes](./02-di-y-beans.md)
