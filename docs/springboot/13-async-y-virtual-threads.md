# 13 — Async y virtual threads

## El problema

Una API HTTP servida por Tomcat (el embebido de Spring Boot) usa un **pool de threads** para procesar requests. Cada request entrante toma un thread del pool, ejecuta tu controller hasta el final, y libera el thread. Si los pasos son rápidos (cálculo en memoria), un thread por request es sostenible.

Pero la mayoría de APIs reales **pasan más tiempo esperando** que computando:

- Esperan respuestas de la DB (decenas a cientos de ms por query).
- Esperan llamadas a otros servicios HTTP.
- Esperan locks.
- Esperan I/O de disco.

Durante esa espera, el thread está **bloqueado**, sin trabajo útil, ocupando memoria. El pool por defecto de Tomcat es 200 threads. Si todos están esperando, las nuevas requests se encolan o fallan. Y multiplicar el pool no es gratis: cada **platform thread** (el de toda la vida) ocupa **~1MB de stack**, y crear 10000 thread es ~10GB de RAM solo en stacks.

Las soluciones históricas:

- **Aumentar el pool** — no escala (memoria, context switching overhead).
- **Reactive (WebFlux)** — non-blocking real, escala enormemente, pero **reescribes el código a callbacks/Mono/Flux**. Curva de aprendizaje fuerte y composición compleja.
- **Async manual con `CompletableFuture`** — puntual, no resuelve el problema arquitectural.

**Java 21 introdujo virtual threads (Project Loom)** como tercera vía. Mantienes el código sintácticamente blocking (linear, fácil de leer, fácil de debug), pero el runtime te da concurrencia masiva — millones de threads concurrentes, no miles. Spring Boot 3.2+ lo soporta con **una sola línea de config**:

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

Este doc cubre virtual threads y los mecanismos complementarios (`@Async`, `CompletableFuture`, concurrencia estructurada) en Spring Boot 3.x.

## Platform threads vs virtual threads

### Platform thread (clásico)

- **1:1 con OS thread**: cada `new Thread()` reserva un OS thread.
- **~1MB de stack** (configurable, no recomendado bajarlo).
- **Scheduled por el OS** (kernel).
- **Crear es caro**: ~microsegundos, syscalls.
- **Límite práctico**: pocas miles por máquina por la memoria.

### Virtual thread (Java 21+)

- **M:N con OS threads**: muchos virtual threads se multiplexan sobre un pool pequeño de **carrier threads** (típicamente uno por CPU core).
- **~few KB de stack** (crece dinámicamente).
- **Scheduled por la JVM** (un ForkJoinPool interno).
- **Crear es trivial**: ~microsegundos pero sin syscall.
- **Sin límite práctico**: crear 1M virtual threads es viable.

La magia: cuando un virtual thread se bloquea en I/O (`socket.read()`, `connection.executeQuery()`, `Thread.sleep()`), la JVM **lo desmonta** del carrier, libera el carrier para correr otro virtual thread, y al volver del I/O, lo remonta sobre **algún** carrier disponible. **El código sigue blocking sintácticamente** — no hay callbacks ni futures.

```java
// El mismo código corre como platform thread (mal) o virtual thread (bien).
public User fetchUser(String id) {
    var user = repository.findById(id).orElseThrow();           // SQL: I/O blocking
    var profile = profileClient.fetch(user.getProfileId());     // HTTP: I/O blocking
    return user.withProfile(profile);
}
```

Con platform threads, mientras el SQL espera, ese thread está parado. Con virtual threads, el carrier se libera para otra request mientras el SQL viaja por la red.

## Activar virtual threads en Spring Boot 3.2+

```yaml
# application.yml
spring:
  threads:
    virtual:
      enabled: true
```

Esto activa virtual threads en:

- **Tomcat** — cada request se asigna a un virtual thread del executor.
- **`@Async`** — el TaskExecutor por defecto pasa a usar virtual threads.
- **`@Scheduled`** — los jobs schedulados corren en virtual threads.
- **`WebClient` blocking** — si lo usas con `.block()`, el bloqueo es virtual-friendly.

Es **un cambio de una línea** que multiplica la capacidad concurrente de tu app sin tocar código. La pega: hay un set de cuidados a conocer.

## Cuándo virtual threads ayudan vs no

### Ayudan masivamente

- **I/O-bound**: HTTP outbound, JDBC, cache networks (Redis), file system.
- **Cualquier `Thread.sleep`, `wait`, `socket.read`** — el virtual thread cede el carrier.
- **APIs que aguantan muchas conexiones concurrentes esperando** (long-polling, server-sent events).

### NO ayudan (o pueden empeorar)

- **CPU-bound**: cálculo intensivo (encryption, ML inference, parsing pesado). Un virtual thread quemando CPU bloquea **a su carrier**. Si tienes 10000 VTs todos haciendo crypto, los 10 carriers están todos pegados — no hay magia.
- **`synchronized` blocks** — los virtual threads **se pinnean al carrier** mientras tengan un `synchronized` activo. Causa contención porque el carrier no puede servir a otro VT.

### El "pinning" — la trampa más sutil

Un virtual thread está **pinned** al carrier cuando:

1. Está dentro de un bloque `synchronized`.
2. Está dentro de una `native method` (JNI).

Mientras está pinned, no puede ceder el carrier ni para esperar I/O. Si una librería de terceros usa `synchronized` (Apache Commons, viejas libs JDBC, lock interno de Tomcat), tus virtual threads pueden quedar atascados.

**Detección**: arranca la JVM con:

```bash
-Djdk.tracePinnedThreads=full
```

Y verás stack traces cuando ocurra pinning. La cura: la librería tiene que migrar `synchronized` → `ReentrantLock`. Para tu código propio, **usa `ReentrantLock` en lugar de `synchronized`** en lugares que tienen I/O dentro.

Java 24 promete eliminar el pinning a nivel JVM, pero hoy (Java 21 LTS) hay que mitigarlo.

## `@Async` para fire-and-forget

Cuando una acción no necesita responder al request original (enviar email, registrar audit log, encolar trabajo), Spring tiene `@Async`:

```java
@Configuration
@EnableAsync
public class AsyncConfig { }
```

```java
@Service
public class NotificationService {

    @Async
    public void sendWelcomeEmail(String email) {
        // se ejecuta en un thread distinto al del request HTTP
        emailSender.send(email, "Welcome!", "Hi there!");
    }
}
```

```java
@Service
public class UserService {

    private final NotificationService notifications;

    public User create(CreateUserRequest req) {
        var user = repository.save(buildUser(req));
        notifications.sendWelcomeEmail(user.getEmail());   // ← no bloquea
        return user;
    }
}
```

El `sendWelcomeEmail` retorna inmediatamente; Spring delega la ejecución a un thread del executor.

### Return types soportados

```java
@Async public void                       // fire-and-forget (sin esperar resultado)
@Async public CompletableFuture<User>    // caller puede esperar resultado o componer
@Async public Future<User>               // legacy; prefiere CompletableFuture
```

### Self-invocation rompe `@Async` (igual que `@Transactional`)

```java
@Service
public class UserService {
    public void create(...) {
        // ...
        this.sendWelcomeEmail(...);   // ❌ no pasa por el AOP proxy
    }

    @Async
    public void sendWelcomeEmail(...) { ... }
}
```

La invocación interna evita el proxy → corre en el thread del caller. Igual que `@Transactional`: si los dos están en la misma clase, **uno tiene que estar en otra clase o inyectarse vía el contexto**.

### `void` no propaga excepciones

```java
@Async
public void notifyEverything() {
    throw new RuntimeException("oops");   // se pierde
}
```

Si retorna `void`, la excepción se loguea (con un `AsyncUncaughtExceptionHandler`) pero **no llega al caller**. Para que el caller pueda manejar errores, retorna `CompletableFuture<Void>` y haz `.exceptionally(...)`.

### Con virtual threads activos

Cuando `spring.threads.virtual.enabled=true`, el TaskExecutor por defecto que usa `@Async` cambia a `VirtualThreadTaskExecutor`. Cada llamada a un método `@Async` crea **un virtual thread nuevo** (no toma de un pool). Crear millones es barato.

## `CompletableFuture` para composición

Cuando necesitas **componer** operaciones asíncronas (fan-out paralelo, encadenar, manejar errores), `CompletableFuture` es la API estándar de Java.

### Paralelizar fan-out

```java
@GetMapping("/{id}/summary")
public CompletableFuture<UserSummary> summary(@PathVariable String id) {
    var userFuture    = supplyAsync(() -> userService.findById(id), executor);
    var ordersFuture  = supplyAsync(() -> orderService.findByUser(id), executor);
    var profileFuture = supplyAsync(() -> profileService.findByUser(id), executor);

    return CompletableFuture.allOf(userFuture, ordersFuture, profileFuture)
        .thenApply(v -> new UserSummary(
            userFuture.join(),
            ordersFuture.join(),
            profileFuture.join()
        ));
}
```

Las tres llamadas corren en paralelo. Si cada una tarda 100ms (I/O), el total es **~100ms**, no 300ms. Spring detecta que el controller devuelve `CompletableFuture` y desbloquea el request thread mientras se resuelven los futuros.

### Encadenar

```java
return userService.findByIdAsync(id)
    .thenCompose(user -> orderService.findRecentAsync(user.getId()))
    .thenApply(orders -> orders.size())
    .exceptionally(ex -> { log.warn("Failed", ex); return 0; });
```

- **`thenApply(Function)`** — transforma el resultado.
- **`thenCompose(Function)`** — encadena otro `CompletableFuture` (flat map).
- **`exceptionally(Function)`** — recovery si falla.
- **`handle((value, ex) -> ...)`** — handler que ve los dos casos.

> 💡 **Con virtual threads, la complejidad de `CompletableFuture` baja**: si solo quieres hacer cosas en paralelo sin componer, abre varios virtual threads imperativamente (`Thread.startVirtualThread(() -> ...)`) y join al final. CompletableFuture sigue brillando para composición compleja.

## Concurrencia estructurada (Java 21 — preview en Boot 3)

Patrón propuesto por Loom para que los grupos de tareas asíncronas se gestionen como **una unidad**:

```java
import java.util.concurrent.StructuredTaskScope;

public UserSummary summary(String id) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var userFork    = scope.fork(() -> userService.findById(id));
        var ordersFork  = scope.fork(() -> orderService.findByUser(id));
        var profileFork = scope.fork(() -> profileService.findByUser(id));

        scope.join();              // espera a las 3
        scope.throwIfFailed();     // si alguna falla, propaga

        return new UserSummary(userFork.get(), ordersFork.get(), profileFork.get());
    }
}
```

Las tres subtareas viven dentro del `try-with-resources` y **mueren al salir** del scope (cancelación implícita). Si una falla, las otras se cancelan automáticamente. Garantía estructural que `CompletableFuture` no ofrece.

Es **preview en Java 21** y Spring no tiene integración first-class todavía. Llega a final en Java 25. Por ahora consideralo experimental — pero conceptualmente es lo que reemplazará a `ExecutorService.invokeAll`.

## Reactive vs virtual threads

Spring tiene dos stacks web:

- **Spring MVC** (servlet, blocking) — con virtual threads, escala enormemente sin reescribir.
- **Spring WebFlux** (reactive, non-blocking) — Mono/Flux, backpressure, programación funcional.

Antes de Java 21, WebFlux era la única opción para alta concurrencia sin gastar RAM en thread stacks. Hoy:

| Necesito...                                          | Mejor opción              |
|------------------------------------------------------|---------------------------|
| Alta concurrencia, código simple, equipo no FP       | MVC + virtual threads     |
| Streaming (server-sent events, WebSockets, chat)      | WebFlux                  |
| Backpressure crítica (producer rápido, consumer lento)| WebFlux                  |
| Mantenibilidad / onboarding nuevo dev                | MVC (más fácil de leer)   |
| Latencia ultra-baja (single-digit ms percentile 99)  | Depende del benchmark     |

Recomendación post-Java 21: **default MVC + virtual threads**. Reactive solo cuando hay una razón concreta (streaming, backpressure, lib reactive específica).

## Patrón aplicado al repo

El `services/spring-api/` actual no usa virtual threads (defaults Spring Boot). Para activarlos:

```yaml
# services/spring-api/src/main/resources/application.yml
spring:
  threads:
    virtual:
      enabled: true
```

Tras un restart, cada request HTTP corre en un virtual thread. El `UserService.create` con su `repository.save()` (JDBC blocking) ahora cede el carrier durante el SQL, multiplicando el throughput potencial.

**Antes de activar en producción**, audita:

1. **Connection pool size**: el HikariCP default es 10 conexiones. Con virtual threads, puedes tener 10000 requests concurrentes intentando obtener una conexión. Sube el pool **o** aceptas que las requests se encolen esperando conexión (correcto en muchos casos).

2. **`synchronized` en tus libs**: ejecuta una carga con `-Djdk.tracePinnedThreads=full` y revisa el log. Si hay pinning en libs críticas, considera reemplazar la lib o aceptar el comportamiento degradado.

3. **Tests**: muchos tests usan `@MockitoBean` y son rápidos — virtual threads no cambian nada ahí. Tests con DB real (Testcontainers) sí se benefician.

## Trampas comunes

1. **`synchronized` con virtual threads**: causa pinning. Usa `ReentrantLock` para tu código. Para libs de terceros, audita con `-Djdk.tracePinnedThreads=full`.

2. **CPU-bound code en virtual threads**: no acelera nada y bloquea carriers. Para cálculo paralelo real (procesar imágenes, encryption), usa `ForkJoinPool` o un `ExecutorService` con platform threads dimensionado a CPU cores.

3. **Connection pool insuficiente**: con VTs puedes tener 10000 requests pidiendo conexión simultáneamente. Tu pool de 10 se vuelve el cuello de botella. Sube `spring.datasource.hikari.maximum-pool-size` o acepta el queueing.

4. **`@Async void`**: la excepción se loguea pero no se propaga al caller. Si necesitas manejar fallos, retorna `CompletableFuture<Void>`.

5. **Self-invocation rompe `@Async`** igual que `@Transactional`. Mover el método anotado a otra clase, o inyectar el bean en sí mismo (raro y feo).

6. **`@EnableAsync` ausente**: la anotación `@Async` se ignora silenciosamente sin `@EnableAsync` en alguna `@Configuration`. Verifica que aparece.

7. **`CompletableFuture` con executor wrong**: si haces `supplyAsync(() -> ...)` sin pasar executor, usa el ForkJoinPool common — diseñado para CPU-bound. Para I/O, pasa **tu** executor (idealmente virtual-thread based):
   ```java
   var executor = Executors.newVirtualThreadPerTaskExecutor();
   supplyAsync(() -> ...).onExecutor(executor);
   ```

8. **`ThreadLocal` con virtual threads**: técnicamente funciona pero pierde sentido. Si tienes 1M VTs cada uno con su `ThreadLocal`, son 1M de instancias allocated. El sucesor es **`ScopedValue`** (Java 21 preview) — inmutable, lifecycle structured.

9. **Mezclar VT con Reactive**: si activas `spring.threads.virtual.enabled=true` en un app WebFlux, los handlers reactive siguen corriendo en event loops (no VTs). Mezclar paradigmas confunde y rara vez aporta. Elige uno.

10. **No medir antes de activar**: la mejora con VTs depende mucho de tu carga. Si tu API es CPU-bound o tiene tan poco tráfico que el pool de 200 nunca se llena, **no hay beneficio**. Mide latencia p95/p99 y throughput antes y después.

11. **`Thread.currentThread().getName()` en logs**: con platform threads ves nombres tipo `http-nio-8080-exec-3`. Con virtual threads ves `Thread[#42,Virtual,5]` o similar — útiles pero distintos. Si tienes alerts basadas en patrón de nombres, ajústalas.

## Ejercicio

1. **Activa virtual threads** y mide impacto:
   - Añade `spring.threads.virtual.enabled: true` a `application.yml`.
   - Genera carga con `hey` o `wrk`: `hey -n 10000 -c 500 http://localhost:8080/users`.
   - Compara throughput y latencia p99 antes y después.

2. **Inspecciona thread names**:
   - Antes de activar VTs: añade `%t` al pattern de log, observa nombres tipo `http-nio-8080-exec-N`.
   - Después de activar: nombres tipo `Thread-N` o `[#NNN,Virtual]`.

3. **Detecta pinning**: arranca con `-Djdk.tracePinnedThreads=full`. Provoca carga y mira si aparecen warnings de "pinned" en stdout. ¿Qué libs lo causan?

4. **`@Async` para audit log fire-and-forget**:
   - Crea `AuditService` con `@Async void log(String action, String userId)`.
   - Anota la config con `@EnableAsync`.
   - Llama `audit.log("user.created", user.getId())` desde `UserService.create`.
   - Verifica con logs que el método corre en otro thread.

5. **Fan-out con `CompletableFuture`**: implementa un endpoint `GET /users/{id}/dashboard` que llama en paralelo a tres métodos (puedes simular con `Thread.sleep(100)` en cada uno). Mide el tiempo total: ¿~100ms o ~300ms?

6. **Concurrencia estructurada (preview)**: reescribe el ejercicio 5 con `StructuredTaskScope.ShutdownOnFailure`. Comprueba que si una de las tres subtareas tira excepción, las otras se cancelan.

7. **Connection pool**: con virtual threads activos, sube el `maximum-pool-size` de Hikari a 50. Genera carga concurrente que haga queries (`POST /users` repetidamente). Mira `hikaricp_connections_pending` en `/actuator/prometheus`. ¿Subió?

8. **Reto — `ScopedValue` para request context**: explora `ScopedValue` (Java 21 preview) como sucesor de `ThreadLocal`. ¿Cómo lo usarías para propagar un `requestId` en código con virtual threads?

## 📖 Lectura paralela

> ⚠️ Esto **no está en el libro** (4ª ed., 2014). Java tenía concurrencia con threads pero virtual threads son una novedad de Java 19 (preview) → Java 21 (final). La integración Spring Boot first-class llegó en Boot 3.2 (2023). Todo este chapter es post-libro.

### JEPs (specs oficiales)

- [JEP 444 — Virtual Threads (final, Java 21)](https://openjdk.org/jeps/444) — el JEP de referencia. Lee la motivación y la sección "Description". 30 min.
- [JEP 453 — Structured Concurrency (preview, Java 21)](https://openjdk.org/jeps/453) — concurrencia estructurada.
- [JEP 446 — Scoped Values (preview, Java 21)](https://openjdk.org/jeps/446) — el sucesor de ThreadLocal.

### Documentación oficial

- [Spring Boot Reference — Virtual Threads](https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.virtual-threads) — la config + comportamiento en Boot.
- [Spring Framework Reference — Asynchronous Execution](https://docs.spring.io/spring-framework/reference/integration/scheduling.html#scheduling-annotation-support-async) — `@Async` con detalle.
- [Spring Framework Reference — Web Async](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-async.html) — `CompletableFuture` desde controllers.

### Charlas y artículos

- [Inside Java — Virtual Threads](https://inside.java/tag/virtualthreads) — content de los autores de Loom.
- [Ron Pressler — Virtual Threads, the Ultimate Cleanup](https://www.youtube.com/results?search_query=ron+pressler+virtual+threads) — la persona detrás de Project Loom explicando el "por qué" en 50 min.
- [Heinz Kabutz — Virtual Threads for the Java Architect](https://www.javaspecialists.eu/talks/) — perspectiva práctica para sistemas existentes.
- [Spring Tips — Virtual Threads](https://spring.io/blog/2022/10/11/embracing-virtual-threads) — la intro oficial cuando Boot empezó a soportarlos.

### Lectura adyacente

- [Project Reactor Reference](https://projectreactor.io/docs/core/release/reference/) — si necesitas WebFlux/reactive aún, la doc canónica.
- [Concurrency in Java — Brian Goetz et al.](https://jcip.net/) — el libro clásico. Pre-Loom pero los fundamentos siguen valiendo.

---

**Anterior:** [12 — Security básica con Spring Security 6](./12-security.md)
**Siguiente:** *(fin del track Spring Boot)*
