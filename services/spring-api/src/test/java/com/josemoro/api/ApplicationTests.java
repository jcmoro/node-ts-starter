package com.josemoro.api;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Boot the full Spring context against a real Postgres in a container.
 * This is the equivalent of node-api's tests running against TEST_DATABASE_URL.
 *
 * On CI: requires Docker available. Locally, runs the first time it pulls
 * the postgres:16-alpine image; subsequent runs use the cached image.
 */
@SpringBootTest
@Testcontainers
@ActiveProfiles("test")
class ApplicationTests {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app")
        .withUsername("postgres")
        .withPassword("postgres");

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        // Hibernate creates the schema in tests since /migrations is run by
        // node-api. For pure-Spring testing we let JPA build it; the
        // production data lives in Postgres managed by node-api migrations.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Test
    void contextLoads() {
        // Smoke test: if the @SpringBootApplication wires up cleanly, this passes.
    }
}
