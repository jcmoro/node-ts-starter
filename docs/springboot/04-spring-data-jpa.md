# 04 — Spring Data JPA: entidades, repos, transacciones

## El problema

Persistir Java en Postgres a pelo es **mucho** código boilerplate:

```java
public User findById(String id) throws SQLException {
    var sql = "SELECT id, email, name FROM users WHERE id = ?";
    try (var conn = dataSource.getConnection();
         var stmt = conn.prepareStatement(sql)) {
        stmt.setString(1, id);
        try (var rs = stmt.executeQuery()) {
            if (!rs.next()) return null;
            return new User(rs.getString("id"), rs.getString("email"), rs.getString("name"));
        }
    }
}
```

Multiplicado por cada query (CRUD básico = al menos 5 métodos por entidad). Repetitivo, propenso a errores (typos en columnas), y desconectado del modelo de objetos (cada método mapea row → objeto a mano).

JPA (Java Persistence API) lo resuelve declarando el mapping una vez en la clase de dominio:

```java
@Entity
@Table(name = "users")
public class User {
    @Id String id;
    String email;
    String name;
    // ...
}
```

Y JPA + Hibernate generan el SQL al vuelo. **Spring Data JPA** añade otra capa: tu repositorio es **una interface vacía**, y Spring Data implementa los métodos por convención.

```java
public interface UserRepository extends JpaRepository<User, String> {
}
```

Esa interface, sin una línea de implementación, ya te da `save`, `findById`, `findAll`, `deleteById`, `count`, `existsById`, etc. — con SQL emitido por Hibernate, transacciones gestionadas por Spring, y mapeo automático.

Este doc cubre lo que ya está implementado en `services/spring-api/src/main/java/com/josemoro/api/users/` y va dos pasos más allá: derived queries, `@Query`, transacciones, y las trampas más comunes de Hibernate.

## La entidad: `User.java`

```java
@Entity
@Table(name = "users")
public class User {

    @Id
    @Column(nullable = false)
    private String id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String name;

    protected User() {
        // JPA no-arg constructor.
    }

    public User(String id, String email, String name) {
        this.id = id;
        this.email = email;
        this.name = name;
    }

    public String getId() { return id; }
    public String getEmail() { return email; }
    public String getName() { return name; }
}
```

Vamos pieza por pieza.

### `@Entity` y `@Table`

`@Entity` declara que esta clase es **persistible**: Hibernate la registra como entidad gestionable. `@Table(name = "users")` mapea al nombre real de la tabla (sin `@Table`, Hibernate asume el nombre de la clase: `User` → `User`, lo cual no encaja con la convención snake_case de Postgres).

> 💡 **Convención**: nombra la entidad en singular (`User`), la tabla en plural (`users`). Es lo idiomático en Hibernate/Spring Data.

### `@Id` — clave primaria

```java
@Id
@Column(nullable = false)
private String id;
```

Toda `@Entity` necesita un `@Id`. En nuestro caso es un `String` (UUID generado en código). Alternativas comunes:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;   // Postgres SERIAL/BIGSERIAL

@Id
@GeneratedValue(strategy = GenerationType.UUID)
private UUID id;   // Hibernate genera el UUID
```

El nuestro **no** usa `@GeneratedValue` — el ID lo construye `UserService.create()` con `UUID.randomUUID().toString()`. Es deliberado: el ID es responsabilidad del **dominio**, no de la base.

### `@Column` con constraints

```java
@Column(nullable = false, unique = true)
private String email;
```

Atributos útiles:

| Atributo            | Significado                                            |
|---------------------|--------------------------------------------------------|
| `name = "..."`      | Nombre real de la columna (si difiere del field)        |
| `nullable = false`  | NOT NULL en el DDL si Hibernate genera schema           |
| `unique = true`     | UNIQUE constraint                                       |
| `length = N`        | VARCHAR(N) (sin esto: VARCHAR(255) por defecto)         |
| `columnDefinition`  | DDL custom (`"TEXT"`, `"jsonb"`, etc.)                  |
| `insertable = false`/`updatable = false` | Read-only en INSERT/UPDATE              |

⚠️ **Importante** en nuestro setup: tenemos `spring.jpa.hibernate.ddl-auto: none`. Hibernate **no genera DDL** — el schema viene de las migraciones SQL en `migrations/`. Los atributos `nullable`/`unique`/`length` se siguen usando para **validación runtime** (`nullable=false` lanza si intentas guardar null), pero no crean nada en la DB.

### Por qué `class`, no `record`

JPA **necesita**:
- Un constructor sin argumentos (puede ser `protected`).
- Setters o capacidad de instanciar campo a campo con reflexión.
- Campos mutables internamente (Hibernate los rellena después de construir).

Los `records` de Java 21 son **inmutables** y no tienen no-arg constructor. **No funcionan como `@Entity`**. Hay propuestas (JEP futuro) pero hoy:

- **Entidades JPA**: `class` con no-arg constructor protegido + getters. Lo que ves en el repo.
- **DTOs (input/output del API)**: `record`. Más limpios, inmutables, perfectos para esto. Es lo que hace `CreateUserRequest` del cap. 03.

> 💡 **Regla práctica**: nunca expongas la `@Entity` en la API HTTP. Define un DTO con record y mapea entity → DTO en el service.

## El repositorio: `JpaRepository<T, ID>`

```java
public interface UserRepository extends JpaRepository<User, String> {
}
```

Una interface **vacía** que extiende `JpaRepository<User, String>` (entidad + tipo de ID). Spring Data genera la implementación al arrancar.

Lo que viene gratis:

```java
// CRUD básico
User                save(User entity);
Optional<User>      findById(String id);
boolean             existsById(String id);
List<User>          findAll();
List<User>          findAllById(Iterable<String> ids);
long                count();
void                deleteById(String id);
void                delete(User entity);
void                deleteAll();

// Paginación + ordenación
Page<User>          findAll(Pageable pageable);
List<User>          findAll(Sort sort);

// Batch
List<User>          saveAll(Iterable<User> entities);
void                deleteAllById(Iterable<String> ids);
```

Sin escribir una línea, ya tienes una API completa contra la tabla `users`.

### Derived queries — query method names

Si el método sigue una convención de nombre, Spring Data **deriva el SQL**:

```java
public interface UserRepository extends JpaRepository<User, String> {
    Optional<User> findByEmail(String email);                  // WHERE email = ?
    List<User>     findByNameContaining(String fragment);      // WHERE name LIKE %?%
    List<User>     findByNameStartingWith(String prefix);      // WHERE name LIKE ?%
    long           countByEmailContaining(String fragment);    // SELECT COUNT(*) WHERE ...
    boolean        existsByEmail(String email);
    List<User>     findByEmailAndName(String email, String name);
    List<User>     findByNameOrEmail(String name, String email);
}
```

Reglas del parser:

- **Prefijos**: `findBy`, `getBy`, `readBy`, `queryBy`, `countBy`, `existsBy`, `deleteBy`.
- **Propiedades**: nombres camelCase de la entidad (`email`, `name`).
- **Operadores**: `And`, `Or`, `Between`, `LessThan`, `GreaterThan`, `Like`, `Containing`, `StartingWith`, `EndingWith`, `In`, `NotIn`, `IsNull`, `IsNotNull`, `OrderBy`.
- **Modificadores**: `Distinct`, `Top<N>`, `First<N>`.

Ejemplos válidos:

```java
List<User> findTop5ByOrderByNameAsc();             // SELECT ... ORDER BY name ASC LIMIT 5
Optional<User> findFirstByEmailContainingIgnoreCase(String fragment);
List<User> findByEmailInAndNameIsNotNull(Collection<String> emails);
```

> 💡 **Cuándo derived queries deja de tener sentido**: cuando el nombre del método pasa de 60 caracteres o lleva 3+ condiciones. Llega un punto donde leer `findByEmailIsNotNullAndNameStartingWithIgnoreCaseAndCreatedAtBetween` es peor que un JPQL explícito. En ese momento, usa `@Query`.

### `@Query` — SQL/JPQL explícito

```java
public interface UserRepository extends JpaRepository<User, String> {

    @Query("SELECT u FROM User u WHERE LOWER(u.email) = LOWER(:email)")
    Optional<User> findByEmailIgnoreCase(@Param("email") String email);

    @Query(value = "SELECT * FROM users WHERE email ~* :pattern", nativeQuery = true)
    List<User> findByEmailRegex(@Param("pattern") String pattern);
}
```

Dos sabores:

- **JPQL** (por defecto): query sobre el modelo de objetos (`User`, no `users`; `u.email`, no la columna). Hibernate lo traduce al dialecto SQL del driver.
- **`nativeQuery = true`**: SQL puro. Necesario para funciones específicas de Postgres (regex con `~*`, `JSONB`, window functions, CTE complejas).

`@Param("email")` nombra parámetros. Spring Data soporta también posicional (`?1`, `?2`), pero los nombrados son más legibles y robustos contra reordenamiento.

### Paginación y ordenación

```java
@GetMapping
public Page<User> list(
    @RequestParam(defaultValue = "0") int page,
    @RequestParam(defaultValue = "20") int size
) {
    return repository.findAll(PageRequest.of(page, size, Sort.by("email").ascending()));
}
```

`Page<T>` te da:

```json
{
  "content": [ { "id": "...", "email": "..." }, ... ],
  "pageable": { "pageNumber": 0, "pageSize": 20, "sort": [...] },
  "totalElements": 142,
  "totalPages": 8,
  "number": 0,
  "first": true,
  "last": false
}
```

Si solo quieres una lista sin metadata, usa `Slice<T>` (no calcula el `COUNT(*)`, más rápido) o `List<T>` con `Pageable`.

## Transacciones: `@Transactional`

JPA exige que toda operación de lectura/escritura ocurra dentro de una **transacción**. Sin transacción explícita, Spring abre una corta por cada método de repository y la cierra al volver. Para operaciones que involucran **varios pasos**, lo querrás controlar tú.

### Patrón básico

```java
@Service
public class UserService {

    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public User create(CreateUserRequest request) {
        if (repository.existsByEmail(request.email())) {
            throw new DuplicateEmailException(request.email());
        }
        var user = new User(UUID.randomUUID().toString(), request.email(), request.name());
        return repository.save(user);
    }

    @Transactional(readOnly = true)
    public List<User> list() {
        return repository.findAll();
    }
}
```

Dos cosas:

1. **`@Transactional` en el método público del service**, no en el controller ni en el repo. El service es la "unidad lógica de trabajo" — agrupa las operaciones que deben commitearse o rollbackearse juntas.
2. **`readOnly = true`** para queries: Hibernate aplica optimizaciones (no necesita dirty checking, no abre transacciones de escritura) y Postgres puede usar replicas read-only si las hubiera.

### Propagación

`@Transactional` acepta un atributo `propagation` que define qué pasa si ya hay una transacción activa al entrar al método. Tabla con los modos comunes:

| Propagation         | Si NO hay tx                  | Si HAY tx                                          |
|---------------------|-------------------------------|----------------------------------------------------|
| `REQUIRED` (default)| Abre una                      | Se une (mismo "scope" lógico)                       |
| `REQUIRES_NEW`      | Abre una                      | **Suspende** la actual, abre una nueva (independiente) |
| `NESTED`            | Abre una                      | Abre un savepoint dentro (rollback parcial posible) |
| `SUPPORTS`          | Corre sin tx                  | Se une                                              |
| `NOT_SUPPORTED`     | Corre sin tx                  | Suspende y corre sin tx                             |
| `NEVER`             | Corre sin tx                  | **Lanza excepción**                                 |
| `MANDATORY`         | **Lanza excepción**           | Se une                                              |

99% de las veces, `REQUIRED` es lo correcto. `REQUIRES_NEW` es útil para logs/audits que deben persistirse aunque la tx exterior haga rollback.

### Rollback

Por defecto, Spring **rollbackea automáticamente** cuando el método tira:

- Cualquier `RuntimeException` (incluyendo `Error`).

Y **NO** rollbackea cuando tira:

- Una `checked exception` (extends `Exception`).

Esta asimetría sorprende viniendo de otros lenguajes. Para forzar rollback con checked exceptions:

```java
@Transactional(rollbackFor = IOException.class)
public void importUsers(InputStream csv) throws IOException { ... }
```

O al revés — no rollbackear con runtime exceptions:

```java
@Transactional(noRollbackFor = BusinessException.class)
public void process(...) { ... }
```

### El mecanismo: AOP proxy

Spring implementa `@Transactional` con un **AOP proxy**: cuando inyectas `UserService`, recibes un objeto wrapper que envuelve tu clase. Las llamadas al proxy abren la transacción, delegan a tu método, y commitean/rollbackean al salir.

**Esto tiene una consecuencia importante**: el proxy solo interviene en **llamadas externas**. Si tu propio método llama a otro método de la misma clase, el `@Transactional` del segundo método **se ignora**:

```java
@Service
public class UserService {

    public void importBatch(List<String> emails) {
        emails.forEach(this::createOne);   // ❌ self-invocation, no pasa por el proxy
    }

    @Transactional
    public void createOne(String email) { ... }
}
```

Síntoma: las transacciones no se aplican y no se rollbackea cuando esperas. Fix: separa los métodos en dos beans, o usa `ApplicationContext.getBean(UserService.class).createOne(email)` (feo pero funciona).

## Schema ownership

En nuestro setup:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: none
```

Hibernate **no toca** el schema. El schema lo definen las migraciones SQL en `migrations/` y se aplican fuera de Spring (con `psql`, `flyway`, `migrate.ts`, o lo que prefieras). Spring solo **lee y escribe filas**.

### Las cuatro opciones de `ddl-auto`

| Valor          | Qué hace                                                     | Cuándo usar                  |
|----------------|--------------------------------------------------------------|-------------------------------|
| `none`         | No toca el schema                                            | **Prod** (este repo)         |
| `validate`     | Verifica al arrancar que las entidades casan con las tablas  | Buena red de seguridad        |
| `update`       | Añade columnas/tablas faltantes (no borra)                   | Prototipo (peligroso en prod) |
| `create-drop`  | Crea todo al arrancar, borra al parar                        | Tests con Testcontainers     |

> 💡 **Considera `validate`**: aunque las migraciones SQL son la fuente de verdad, `validate` te avisa si alguien cambia una entidad sin actualizar el schema (o viceversa). Catch barato de bugs caros.

## El problema N+1 y el OSIV

El gotcha más famoso de Hibernate. Considera:

```java
@Entity
@Table(name = "users")
public class User {
    @Id String id;

    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List<Order> orders;
}
```

Y un controller:

```java
@GetMapping
public List<UserWithOrderCount> list() {
    return repository.findAll().stream()
        .map(u -> new UserWithOrderCount(u.getId(), u.getOrders().size()))
        .toList();
}
```

Una query `SELECT * FROM users` (la del `findAll()`) + **una query adicional por cada user** para cargar `orders` cuando lo accedes. 100 users = 101 queries. Eso es **N+1**.

Soluciones:

1. **`@EntityGraph`**: especifica qué cargar en la query original.
   ```java
   @EntityGraph(attributePaths = {"orders"})
   List<User> findAll();
   ```

2. **JPQL con `JOIN FETCH`**:
   ```java
   @Query("SELECT u FROM User u LEFT JOIN FETCH u.orders")
   List<User> findAllWithOrders();
   ```

3. **Proyección directa a DTO**:
   ```java
   @Query("SELECT new com.josemoro.api.users.UserWithOrderCount(u.id, COUNT(o)) " +
          "FROM User u LEFT JOIN u.orders o GROUP BY u.id")
   List<UserWithOrderCount> findAllWithOrderCount();
   ```

### OSIV (Open Session In View)

Spring Boot **desactiva** OSIV en nuestro `application.yml`:

```yaml
spring:
  jpa:
    open-in-view: false
```

OSIV es una "feature" legacy que mantiene abierto el Hibernate session hasta que el view layer renderiza la respuesta. Permitía cargar lazy relations al renderizar pero **oculta** los N+1 hasta que pegas con problemas de performance en producción.

**Con `open-in-view: false`** (recomendado): cualquier acceso lazy fuera de un `@Transactional` lanza `LazyInitializationException`. Te obliga a decidir el fetch explícitamente.

## Trampas comunes

1. **Records como `@Entity`**: no funciona — JPA necesita no-arg constructor y mutabilidad. Usa `class` para entities, `record` para DTOs.

2. **`equals`/`hashCode` con el id en entities**: si el id es generado (`@GeneratedValue`), antes del primer `save()` es `null`. Si lo usas en `hashCode`, la entidad **cambia de hash** después del save → rompe Sets, Maps, caches. Soluciones:
   - No sobreescribir `equals`/`hashCode` (defaults de `Object` funcionan: identidad).
   - Usar un **business key** (ej. email para Users).
   - Lombok `@EqualsAndHashCode(of = "id")` solo si el id se asigna **antes** del save (como hacemos con UUIDs en el constructor).

3. **`@Transactional` en métodos `private`**: el AOP proxy **no puede** interceptarlos. Tienen que ser `public`. Síntoma: la anotación se ignora silenciosamente.

4. **Self-invocation rompe `@Transactional`**: ya cubierto arriba. Cualquier `this.foo()` evita el proxy.

5. **Lazy loading fuera de tx**: con `open-in-view: false`, acceder a una relación lazy en el controller (post-service) lanza `LazyInitializationException`. Carga lo que necesites **dentro** del `@Transactional` del service.

6. **`findById().get()` sin manejar `Optional.empty()`**: `Optional.get()` lanza `NoSuchElementException`. Usa `.orElseThrow(...)` con tu propia excepción de dominio, o el patrón `Optional.map(...).orElseGet(...)` del cap. 03.

7. **`save()` en update sin recibir el resultado**:
   ```java
   user.setEmail(newEmail);
   repository.save(user);   // ❌ podrías no necesitarlo
   ```
   Si `user` es una entidad ya gestionada (cargada de la DB en la misma tx), Hibernate **detecta el cambio automáticamente** (dirty checking) y emite UPDATE al commit. El `save()` extra no rompe pero es ruidoso. Para entities nuevas (no gestionadas) o tras un `clear()` del session, sí necesitas `save`.

8. **Cascade en `@OneToMany` con cuidado**:
   ```java
   @OneToMany(mappedBy = "user", cascade = CascadeType.ALL)
   List<Order> orders;
   ```
   `CascadeType.ALL` incluye `REMOVE` — borrar el `User` borra todas sus `Order`. Útil para composición real, peligroso para asociaciones. Empieza sin cascade y añade el específico (`PERSIST`, `MERGE`) si lo necesitas.

9. **`@OneToMany` sin `mappedBy`** crea una **join table** que probablemente no quieres. Si la FK vive en la tabla "child", **siempre** usa `mappedBy` apuntando al campo `@ManyToOne` del child.

10. **Confundir entity y Hibernate proxy con `instanceof`**: cuando Hibernate carga una entity por lazy proxy, el resultado **no es** instancia exacta de tu clase, sino una subclase generada en runtime. Por eso `entity instanceof MySubclass` puede dar false aunque "lógicamente" lo sea. Usa `Hibernate.unproxy(entity)` o `entity.getClass().equals(...)` con cuidado.

## Ejercicio

1. **Derived query**: añade `Optional<User> findByEmail(String email)` a `UserRepository`. Cambia `UserService.create` para que falle si el email ya existe (lanza una excepción custom `DuplicateEmailException`). Verifica con tests que el POST devuelve 409 (eso lo cubre el doc 07).

2. **Paginación end-to-end**: cambia el `GET /users` para aceptar `Pageable` directamente:
   ```java
   @GetMapping
   public Page<User> list(Pageable pageable) {
       return repository.findAll(pageable);
   }
   ```
   Spring resuelve `Pageable` desde `?page=0&size=10&sort=email,asc` automáticamente. Prueba con `curl 'http://localhost:8080/users?page=0&size=2&sort=email,asc'`.

3. **`@Query` con JPQL**: añade `findByEmailLowercase(String email)` que use `LOWER(u.email)` en la cláusula WHERE. Compara con la derived query `findByEmailIgnoreCase` — Spring Data Hibernate ya soporta `IgnoreCase` nativo, así que el `@Query` no aporta. La idea del ejercicio es **ver el SQL emitido en ambos casos** activando `logging.level.org.hibernate.SQL=DEBUG`.

4. **`@Transactional(readOnly = true)`**: aplícalo a `UserService.list()` y `findById()`. Confirma que los logs de Hibernate ya no muestran transacciones de escritura (`begin/commit` por cada SELECT). Mide el delta (pequeño en una tabla pequeña, importante en alta carga).

5. **N+1 simulado**: añade una colección `@OneToMany List<Order> orders` a `User` (puedes crear una tabla `orders(id, user_id, total)` en una migración nueva). Implementa `GET /users/{id}/order-summary` que devuelva `{ user, totalOrders, sumAmount }`. Hazlo primero **naive** (cargar user + iterar orders), observa las N+1 en logs, refactoriza con `@EntityGraph` o `JOIN FETCH`.

6. **Reto — Native query**: implementa `searchByEmailRegex(String pattern)` usando `nativeQuery = true` y el operador `~*` de Postgres. Confirma que Hibernate emite el SQL tal cual sin "traducirlo". Comprobar dialecto con `EXPLAIN`.

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014)

- **Capítulo 11 — *Persisting data with object-relational mapping***: lee la introducción a JPA, `@Entity`, `@Id`. **Salta** la sección de Hibernate API directa y XML mappings (legacy).

> ⚠️ El libro usa **`javax.persistence`** (JPA 2.x). En Spring 6 / Boot 3 todo es **`jakarta.persistence`** (JPA 3.x). Las anotaciones tienen el mismo nombre, solo cambió el package.

> ⚠️ La parte de `JpaTemplate` del libro está **deprecated** en Spring moderno. La forma de hoy es **siempre** `JpaRepository`.

### Documentación oficial

- [Spring Data JPA Reference — Working with Spring Data Repositories](https://docs.spring.io/spring-data/jpa/reference/repositories.html) — la referencia canónica para derived queries, `@Query`, `@Modifying`.
- [Spring Data JPA Reference — Pagination and Sorting](https://docs.spring.io/spring-data/jpa/reference/repositories/query-methods-details.html#repositories.special-parameters) — `Pageable`, `Slice`, `Sort`.
- [Spring Framework Reference — Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html) — el modelo de transacciones, propagation, AOP proxy en detalle.
- [Vlad Mihalcea — High-Performance Java Persistence](https://vladmihalcea.com/tutorials/hibernate/) — referencia avanzada sobre N+1, fetch strategies, second-level cache. Para cuando JPA "se hace lenta".

---

**Anterior:** [03 — Controllers y Bean Validation](./03-controllers-y-validation.md)
**Siguiente:** [05 — Records y sealed classes para el dominio](./05-records-y-sealed-classes.md)
