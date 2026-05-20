package com.josemoro.api.users;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * End-to-end test: boots the full Spring context against a real Postgres,
 * uses TestRestTemplate to hit the real Tomcat. Authenticates via HTTP Basic
 * using the in-memory users defined in SecurityConfig.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UserApiE2ETest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app");

    @DynamicPropertySource
    static void schemaProps(DynamicPropertyRegistry registry) {
        // In production the schema is owned by external SQL migrations. For
        // this E2E test, let Hibernate generate it from the entities.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Autowired TestRestTemplate restTemplate;

    private TestRestTemplate asAlice() {
        return restTemplate.withBasicAuth("alice", "alice-secret");
    }

    private TestRestTemplate asAdmin() {
        return restTemplate.withBasicAuth("admin", "admin-secret");
    }

    @Test
    void create_then_read_round_trip_authenticated() {
        var createResponse = asAlice().postForEntity(
            "/users",
            new CreateUserRequest("jose@example.com", "Jose"),
            User.class
        );

        assertThat(createResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(createResponse.getHeaders().getLocation()).isNotNull();
        var created = createResponse.getBody();
        assertThat(created).isNotNull();
        assertThat(created.getEmail()).isEqualTo("jose@example.com");

        var readResponse = asAlice().getForEntity("/users/" + created.getId(), User.class);

        assertThat(readResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(readResponse.getBody()).isNotNull();
        assertThat(readResponse.getBody().getId()).isEqualTo(created.getId());
    }

    @Test
    void duplicate_email_returns_409_with_problem_json() {
        asAlice().postForEntity(
            "/users",
            new CreateUserRequest("first@example.com", "First"),
            Object.class
        );

        var dup = asAlice().postForEntity(
            "/users",
            new CreateUserRequest("First@Example.COM", "Other"),
            String.class
        );

        assertThat(dup.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(dup.getHeaders().getContentType().toString()).contains("application/problem+json");
        assertThat(dup.getBody()).contains("first@example.com");
    }

    @Test
    void missing_user_returns_404_with_problem_json() {
        var resp = asAlice().getForEntity("/users/does-not-exist", String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(resp.getHeaders().getContentType().toString()).contains("application/problem+json");
        assertThat(resp.getBody()).contains("does-not-exist");
    }

    // ----- Security-focused tests -----

    @Test
    void users_endpoint_requires_authentication() {
        var resp = restTemplate.getForEntity("/users", String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void delete_returns_403_for_user_without_admin() {
        var resp = asAlice().exchange(
            "/users/some-id",
            org.springframework.http.HttpMethod.DELETE,
            null,
            String.class
        );

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void health_is_public() {
        var resp = restTemplate.getForEntity("/health", String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resp.getBody()).contains("\"status\":\"ok\"");
    }
}
