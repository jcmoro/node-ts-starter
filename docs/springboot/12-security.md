# 12 — Security básica con Spring Security 6

## El problema

Una API pública tiene que responder, como mínimo, a cinco preguntas de seguridad **antes** de ejecutar la lógica de negocio:

1. **Authentication** — ¿quién es el caller? (un user, un service, un anónimo)
2. **Authorization** — ¿puede este caller hacer **esta** operación concreta?
3. **Transport** — ¿la comunicación está cifrada? (HTTPS, mTLS)
4. **Input safety** — ¿el input es seguro o intentan colarte algo? (CSRF, mass assignment, injection)
5. **Output safety** — ¿estás devolviendo datos que el caller no debería ver?

Sin un framework, esto se acumula en código boilerplate por cada endpoint. **Spring Security** lo centraliza en una **cadena de filtros HTTP** declarativa: defines reglas (estos paths necesitan auth, estos roles pueden acceder, este endpoint es público) y Spring las aplica en orden antes de que llegue al controller.

Este doc cubre Spring Security 6 (el de Spring Boot 3.x) con foco en el patrón que vas a usar en una **API REST stateless con JWT**. El estado actual del repo es **sin Spring Security** — todos los endpoints son públicos. Voy a explicar cómo añadirlo y por qué tomar ciertas decisiones.

## El modelo: filter chain

Cuando llega un request, Spring lo pasa por una **cadena de filtros** antes del controller. La cadena por defecto cuando incluyes `spring-boot-starter-security` tiene ~15 filtros: gestión de sesión, CSRF, headers, autenticación, autorización, etc.

Configurar Spring Security = **declarar un `SecurityFilterChain` bean** que define las reglas:

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())                      // API stateless → sin CSRF
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/health", "/actuator/health/**").permitAll()
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .httpBasic(Customizer.withDefaults())              // basic auth para demos
            .build();
    }
}
```

Léelo de arriba abajo: deshabilita CSRF, hace la sesión stateless, define qué paths necesitan qué nivel de auth, y elige HTTP Basic como mecanismo de autenticación.

Sin el `@Bean SecurityFilterChain`, Spring Boot aplica un **filterChain por defecto**: TODO requiere autenticación, con un usuario generado al arrancar (`user` + password aleatoria impresa en el log). Útil como red de seguridad pero no para producción.

## Autenticación: las opciones

Hay cinco mecanismos comunes. Elige según el caso:

| Mecanismo                   | Cuándo                                                    | Pros                           | Contras                          |
|-----------------------------|-----------------------------------------------------------|--------------------------------|----------------------------------|
| **HTTP Basic**              | Demos, scripts, healthchecks privados                     | Trivial de configurar          | Credenciales en cada request     |
| **Form login + session**    | Apps web server-rendered                                  | UX clásica con cookie          | Stateful (no escala horizontal sin sticky session o store distribuido) |
| **JWT (Bearer token)**      | APIs REST puras, mobile, SPAs                             | Stateless, escala, decodificación offline | Revocación complicada      |
| **OAuth2 / OIDC**           | Login con Google/Microsoft/etc., delegación de identidad  | Delega identity provider       | Más piezas                       |
| **mTLS**                    | Comunicación service-to-service                           | Sin tokens en headers          | Gestión de certificados pesada   |

Lo idiomático para una API REST moderna: **JWT como Bearer token**, emitido por un **Authorization Server** externo (Keycloak, Auth0, Okta, AWS Cognito) o tu propio service de identidad.

## Patrón JWT con Spring Security: resource server

La separación canónica:

- **Authorization Server** (AS): emite tokens al usuario tras autenticación. No es Spring Security — es Keycloak, Auth0, etc.
- **Resource Server** (RS): tu API. Recibe tokens en el header `Authorization: Bearer <jwt>` y los **valida** sin contactar al AS en cada request.

Spring Boot tiene starter dedicado:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
```

Configuración mínima:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          # El AS expone su public key set (JWKS) aquí; Spring la descarga al
          # arrancar y la usa para verificar firmas sin nuevas llamadas al AS.
          jwk-set-uri: https://auth.example.com/.well-known/jwks.json
          # O para JWTs firmados con HMAC (HS256), un secret:
          # secret: ${JWT_HMAC_SECRET}
```

Y en el `SecurityFilterChain`:

```java
return http
    .csrf(csrf -> csrf.disable())
    .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
    .authorizeHttpRequests(auth -> auth
        .requestMatchers("/health", "/actuator/health/**").permitAll()
        .anyRequest().authenticated()
    )
    .oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults()))
    .build();
```

Lo que pasa por request:

1. Llega `Authorization: Bearer eyJhbGc...`.
2. `BearerTokenAuthenticationFilter` extrae el token.
3. `JwtDecoder` lo valida: firma (con la JWK), `iss` (issuer match), `aud` (audience), `exp` (no expirado).
4. Si pasa, crea un `Authentication` con las claims como atributos.
5. El controller recibe la request con `SecurityContextHolder` poblado.

Si falla cualquier paso → **401 Unauthorized** con WWW-Authenticate header indicando qué falló (`invalid_token`, `expired`, etc.).

### Claims → authorities

Por defecto, Spring mapea la claim `scope` (separada por espacios) a authorities con prefijo `SCOPE_`:

```
Token claim: "scope": "users:read users:write"
Authorities: ["SCOPE_users:read", "SCOPE_users:write"]
```

Si tu issuer pone roles en otra claim (`realm_access.roles` en Keycloak, `roles` en Auth0), customizas el mapeo:

```java
@Bean
public JwtAuthenticationConverter jwtAuthenticationConverter() {
    var authoritiesConverter = new JwtGrantedAuthoritiesConverter();
    authoritiesConverter.setAuthorityPrefix("ROLE_");
    authoritiesConverter.setAuthoritiesClaimName("roles");

    var converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
    return converter;
}
```

Y en la config:

```java
.oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())))
```

## Autorización: URL-based y method-level

### URL-based en el filter chain

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.GET, "/users").hasAuthority("SCOPE_users:read")
    .requestMatchers(HttpMethod.POST, "/users").hasAuthority("SCOPE_users:write")
    .requestMatchers("/actuator/**").hasRole("ADMIN")
    .requestMatchers("/health", "/health/**").permitAll()
    .anyRequest().authenticated()
)
```

Reglas:

- **Orden importa**: la primera regla que matchea gana. Pon las más específicas primero.
- **`requestMatchers` (Spring 6)** reemplaza al deprecated `antMatchers`.
- **`hasRole("ADMIN")`** equivale a `hasAuthority("ROLE_ADMIN")` — el prefijo `ROLE_` es implícito.
- **`permitAll()`** = sin autenticación. **`anonymous()`** = sin autenticación pero crea un Authentication anonymous (sutil; raramente diferente).
- **`anyRequest().authenticated()`** como red de seguridad al final — paths no listados requieren auth por defecto.

### Method-level con `@PreAuthorize`

```java
@RestController
@RequestMapping("/users")
public class UserController {

    @PostMapping
    @PreAuthorize("hasAuthority('SCOPE_users:write')")
    public ResponseEntity<User> create(@Valid @RequestBody CreateUserRequest req) { ... }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('SCOPE_users:read') or #id == authentication.name")
    public User get(@PathVariable String id) { ... }
}
```

`@PreAuthorize` evalúa una **expresión SpEL** antes de entrar al método. Variables disponibles:

- `authentication` — el Authentication actual (acceso a name, authorities, principal).
- `#paramName` — referencia a parámetros del método (como `#id` arriba).

Para activarlo:

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity   // ← imprescindible para @PreAuthorize
public class SecurityConfig { ... }
```

### Cuándo URL-based vs method-level

- **URL-based**: reglas amplias por path (`/admin/**` solo ADMIN). Visible en un solo lugar (el SecurityFilterChain).
- **Method-level**: reglas con lógica (acceso a recurso propio, condiciones de negocio). Junto al método; lee mejor.

Lo idiomático es **combinar los dos**: URL-based como red de seguridad gruesa, method-level para reglas finas.

## Password hashing (si tienes user-password local)

Si tu API maneja credentials directamente (no delegas todo al AS), **nunca** guardes passwords en plano. Usa `BCryptPasswordEncoder`:

```java
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);   // cost factor 12 (~250ms por hash)
}
```

Y al crear users:

```java
@Service
public class UserService {

    private final UserRepository repository;
    private final PasswordEncoder encoder;

    public UserService(UserRepository repository, PasswordEncoder encoder) {
        this.repository = repository;
        this.encoder = encoder;
    }

    public User register(String email, String rawPassword) {
        var hash = encoder.encode(rawPassword);
        return repository.save(new User(..., email, hash));
    }
}
```

Y al login:

```java
boolean matches = encoder.matches(rawPassword, user.getPasswordHash());
```

### `DelegatingPasswordEncoder` para migración

Si tu DB tiene passwords de diferentes algoritmos (legacy MD5, bcrypt actual), usa `DelegatingPasswordEncoder` que detecta el prefijo:

```
$2a$12$...        ← bcrypt (current)
{bcrypt}$2a$12$.. ← formato delegating
{MD5}xxxxxxxx     ← legacy, marca para upgrade
```

Es el default desde Spring Security 5. Permite migrar usuarios al esquema actual gradualmente cuando hagan login.

## CORS

Para que un frontend en otro origen (otra URL) pueda llamar a tu API:

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        // ... resto
        .build();
}

@Bean
public CorsConfigurationSource corsConfigurationSource() {
    var config = new CorsConfiguration();
    config.setAllowedOrigins(List.of("http://localhost:5173", "https://app.example.com"));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-Id"));
    config.setAllowCredentials(true);                       // cookies / authorization
    config.setMaxAge(Duration.ofHours(1));                  // cache del preflight

    var source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
}
```

⚠️ **No uses `setAllowedOrigins(List.of("*"))` con `setAllowCredentials(true)`**: combinación bloqueada por el browser. Si necesitas wildcards, usa `setAllowedOriginPatterns(List.of("https://*.example.com"))`.

## CSRF: cuándo deshabilitar

**CSRF (Cross-Site Request Forgery)** es relevante cuando un browser envía cookies automáticamente. En una API stateless con tokens en headers, **no aplica** (un atacante no puede leer ni inyectar un Bearer token desde otro origen).

```java
.csrf(csrf -> csrf.disable())
```

⚠️ **Solo deshabilita CSRF si realmente eres stateless**. Si usas sesiones con cookies + form login, CSRF debe estar habilitado.

## Security headers (vienen gratis)

Spring Security añade por defecto:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0           # deprecated por la spec moderna; Spring lo manda
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
Pragma: no-cache
Expires: 0
Referrer-Policy: no-referrer
```

Para añadir HSTS (HTTPS strict transport security) y CSP (Content Security Policy):

```java
.headers(h -> h
    .httpStrictTransportSecurity(hsts -> hsts.maxAgeInSeconds(31536000))
    .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'"))
)
```

HSTS le dice al browser "siempre HTTPS para este host"; aplica solo si tu API se sirve por HTTPS (típicamente en prod, no en dev local).

## Acceder al user actual desde un controller

Tres formas equivalentes:

```java
// 1) Inyección directa (Spring 6+)
@GetMapping("/me")
public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
    return Map.of("sub", jwt.getSubject(), "scopes", jwt.getClaim("scope"));
}

// 2) Authentication
@GetMapping("/me")
public Map<String, Object> me(Authentication auth) {
    return Map.of("name", auth.getName(), "authorities", auth.getAuthorities());
}

// 3) SecurityContextHolder (en services, fuera de controllers)
public void doSomething() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    var userId = auth.getName();
}
```

`@AuthenticationPrincipal` es la más limpia en controllers.

## Trampas comunes

1. **Añadir el starter sin `SecurityFilterChain`**: Spring Boot aplica el default → **TODO requiere auth** con un user/password aleatorio en logs. Tu API devuelve 401 en todo, incluso `/health`. Define un `SecurityFilterChain` explícito desde el principio.

2. **`permitAll()` no es "ignore"**: el request **sí pasa** por la security filter chain (CSRF, headers, audit), solo no requiere auth. Si quieres que un path **no pase** por security en absoluto, configura `WebSecurityCustomizer` con `web.ignoring().requestMatchers("/path")`. Útil para assets estáticos; raro para endpoints API.

3. **CSRF activo en API stateless**: tus POST/PUT/DELETE fallan con 403 silenciosamente (Spring no devuelve mensaje claro). Si es API REST stateless con tokens, **siempre** `csrf().disable()`.

4. **`@PreAuthorize` no hace nada**: olvidaste `@EnableMethodSecurity` (Spring Security 6) o `@EnableGlobalMethodSecurity(prePostEnabled = true)` (Spring Security 5). La anotación queda decorativa y todos los métodos son accesibles. Verifica añadiendo un `@PreAuthorize("denyAll()")` — si pasa, no está activo.

5. **Reglas de `requestMatchers` en mal orden**: la primera que matchea gana. Si pones `anyRequest().authenticated()` antes de `requestMatchers("/health").permitAll()`, `/health` requiere auth porque `anyRequest` captura primero. **Específicas primero, fallback al final**.

6. **`hasRole("ADMIN")` vs `hasAuthority("ROLE_ADMIN")`**: equivalentes. Pero `hasRole("ROLE_ADMIN")` **falla silenciosamente** (Spring le añade `ROLE_` automáticamente → busca `ROLE_ROLE_ADMIN`). Usa **uno** de los dos consistentemente.

7. **CORS sin preflight**: si tu CORS config no incluye `OPTIONS` en `setAllowedMethods`, los browsers envían un OPTIONS preflight que falla. Algunos clientes (curl, Postman) no preflightean → funciona en tests pero falla en browsers. **Siempre** incluye `OPTIONS`.

8. **Password encoder cambiado sin migración**: si cambias de bcrypt a argon2 (o el cost factor) sin migración, **todos los users existentes no pueden hacer login**. Usa `DelegatingPasswordEncoder` (default desde Spring Security 5) y upgrade gradual.

9. **JWT con shared secret en multi-service**: si tu API y un microservicio adyacente comparten el HMAC secret para verificar tokens, **cualquiera de los dos compromised compromete el sistema**. Mejor: cada AS firma con clave asimétrica (RS256), services verifican con la pública (rotable, distribuible vía JWKS).

10. **No tener rate limiting**: Spring Security **no lo da out of the box**. Sin rate limiting, un atacante puede probar 10000 passwords por segundo (si tienes login local) o saturar tu API con peticiones autenticadas. Soluciones: Bucket4j (lib), API gateway externo (NGINX, Envoy, AWS API Gateway), Redis-based rate limiter.

11. **Filter custom mal ordenado**: si añades un filtro propio sin `addFilterAfter(...)` o `addFilterBefore(...)`, Spring no sabe dónde ponerlo. Aprende los nombres canónicos: `BearerTokenAuthenticationFilter`, `BasicAuthenticationFilter`, `UsernamePasswordAuthenticationFilter`, `AuthorizationFilter`.

## Ejercicio

1. **Añade `spring-boot-starter-security` al `pom.xml`** y arranca **sin** definir `SecurityFilterChain`. Confirma que:
   - `curl http://localhost:8080/health` devuelve 401.
   - En los logs aparece "Using generated security password: xxx-yyy-zzz".
   - `curl -u user:<password> http://localhost:8080/users` funciona (HTTP Basic con el user generado).

2. **`SecurityFilterChain` mínimo**: define un `@Bean` que:
   - `permitAll` a `/health`, `/actuator/health/**`.
   - `authenticated` al resto.
   - Use `httpBasic` por simplicidad de demo.
   - `csrf().disable()` y `sessionManagement().sessionCreationPolicy(STATELESS)`.

3. **In-memory user store**:
   ```java
   @Bean
   public UserDetailsService users(PasswordEncoder encoder) {
       var alice = User.withUsername("alice")
           .password(encoder.encode("alice-secret"))
           .roles("USER").build();
       var admin = User.withUsername("admin")
           .password(encoder.encode("admin-secret"))
           .roles("USER", "ADMIN").build();
       return new InMemoryUserDetailsManager(alice, admin);
   }

   @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
   ```
   Prueba `curl -u alice:alice-secret /users` (200), `curl -u alice:wrong /users` (401), `curl /users` (401).

4. **`@PreAuthorize` con `@EnableMethodSecurity`**: añade `@PreAuthorize("hasRole('ADMIN')")` a `UserController.create`. Confirma que `alice` no puede crear (`403`) pero `admin` sí (`201`).

5. **CORS para el frontend dev**: configura `CorsConfigurationSource` para `http://localhost:5173`. Verifica desde un cliente JS en esa URL que el preflight pasa y la request funciona.

6. **JWT resource server (simulado)**: añade `spring-boot-starter-oauth2-resource-server`. Para testear sin un IdP real, configura un `JwtDecoder` con un secret HMAC:
   ```java
   @Bean
   public JwtDecoder jwtDecoder() {
       var secret = new SecretKeySpec("change-me-32-byte-secret-1234567".getBytes(), "HmacSHA256");
       return NimbusJwtDecoder.withSecretKey(secret).build();
   }
   ```
   Genera un JWT manualmente con jwt.io con el mismo secret y `scope: "users:write"`. Prueba `curl -H "Authorization: Bearer <jwt>" -X POST /users`.

7. **Reto — método con propietario**: usa `@PreAuthorize("#id == authentication.name or hasRole('ADMIN')")` en un endpoint `GET /users/{id}`. Pruébalo: alice puede leer `/users/alice` pero no `/users/admin`; admin puede leer ambos.

## 📖 Lectura paralela

### *Spring in Action* (4ª ed, 2014)

- **Capítulo 9 — *Securing web applications***: la motivación de Spring Security sigue válida — concepto de filter chain, autenticación, autorización. **Salta** todo lo de XML config, `<http auto-config="true">`, `UserDetailsService` con JDBC manual.

> ⚠️ **Pre-Spring Security 5/6**: el libro usa Spring Security 3.x. El cambio en Spring Security 5 (config Java Lambda DSL) y especialmente en 6 (deprecación del adapter pattern `WebSecurityConfigurerAdapter`) hacen que la mayor parte del código del libro sea inutilizable. **Lee solo la teoría general**.

### Documentación oficial

- [Spring Security Reference — Servlet Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html) — modelo de filter chain en detalle. 20 min.
- [Spring Security Reference — OAuth2 Resource Server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html) — el chapter clave para APIs con JWT.
- [Spring Security Reference — Method Security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — `@PreAuthorize`, `@PostAuthorize`, SpEL.
- [Spring Boot Reference — Security](https://docs.spring.io/spring-boot/reference/web/spring-security.html) — la integración boot-específica y auto-config.

### Estándares y guías

- [OWASP API Security Top 10](https://owasp.org/API-Security/) — checklist de los 10 errores más comunes en APIs. Lectura obligada al menos una vez.
- [RFC 6749 — OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749) y [RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens](https://datatracker.ietf.org/doc/html/rfc9068).
- [JWT.io](https://jwt.io) — debugger online de JWTs (útil para entender qué hay dentro de un token).

### Herramientas

- **Keycloak** — Authorization Server open-source para development local. Lanzas un Keycloak via Docker, configuras un realm + client, y tu Spring app actúa de Resource Server contra él.
- **`spring-security-test`** — soporte de tests con `@WithMockUser`, `SecurityMockMvcRequestPostProcessors.jwt()` para simular tokens.

---

**Anterior:** [11 — Docker multi-stage y Cloud Native Buildpacks](./11-docker-multistage-y-buildpacks.md)
**Siguiente:** [13 — Async y virtual threads](./13-async-y-virtual-threads.md)
