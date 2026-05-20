package com.josemoro.api.users;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Slice test for the JPA layer. Uses a real Postgres via Testcontainers
 * because Hibernate's behaviour against H2 diverges from Postgres in subtle
 * ways (regex operators, JSONB, sequences). @AutoConfigureTestDatabase(NONE)
 * prevents the @DataJpaTest default of swapping the DataSource for H2.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = Replace.NONE)
@Testcontainers
class UserRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app");

    @DynamicPropertySource
    static void schemaProps(DynamicPropertyRegistry registry) {
        // The default app config has ddl-auto: none (schema owned by external
        // migrations). For this slice test, let Hibernate generate it.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Autowired UserRepository repository;
    @Autowired TestEntityManager em;

    @Test
    void findByEmail_returns_the_matching_user() {
        em.persistAndFlush(new User("u1", "alice@example.com", "Alice"));
        em.persistAndFlush(new User("u2", "bob@example.com", "Bob"));

        var found = repository.findByEmail("alice@example.com");

        assertThat(found).isPresent();
        assertThat(found.get().getName()).isEqualTo("Alice");
    }

    @Test
    void findByEmail_returns_empty_when_no_match() {
        em.persistAndFlush(new User("u1", "alice@example.com", "Alice"));

        assertThat(repository.findByEmail("missing@example.com")).isEmpty();
    }

    @Test
    void existsByEmail_is_true_when_present() {
        em.persistAndFlush(new User("u1", "alice@example.com", "Alice"));

        assertThat(repository.existsByEmail("alice@example.com")).isTrue();
        assertThat(repository.existsByEmail("missing@example.com")).isFalse();
    }

    @Test
    void save_persists_a_new_user_and_findAll_returns_it() {
        repository.save(new User("u1", "alice@example.com", "Alice"));
        repository.save(new User("u2", "bob@example.com", "Bob"));

        assertThat(repository.findAll())
            .hasSize(2)
            .extracting(User::getEmail)
            .containsExactlyInAnyOrder("alice@example.com", "bob@example.com");
    }
}
