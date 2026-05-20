package com.josemoro.api.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import com.josemoro.api.audit.AuditService;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock UserRepository repository;
    @Mock AuditService audit;
    SimpleMeterRegistry registry;
    UserService service;

    @BeforeEach
    void setUp() {
        // Real (lightweight) registry — lets us assert on the Counter value
        // after exercising the service.
        registry = new SimpleMeterRegistry();
        service = new UserService(repository, audit, registry);
    }

    @Test
    void create_returns_Created_for_new_email_and_increments_counter() {
        var command = new CreateUserCommand(new Email("jose@example.com"), new UserName("Jose"));
        when(repository.existsByEmail("jose@example.com")).thenReturn(false);
        when(repository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        var result = service.create(command);

        assertThat(result).isInstanceOf(CreateUserResult.Created.class);
        var created = (CreateUserResult.Created) result;
        assertThat(created.user().getEmail()).isEqualTo("jose@example.com");
        assertThat(created.user().getId()).hasSize(36);   // UUID
        verify(repository, times(1)).save(any(User.class));

        // Counter incremented for the successful creation.
        assertThat(registry.counter("users.created.total", "source", "api").count())
            .isEqualTo(1.0);
    }

    @Test
    void create_returns_DuplicateEmail_without_saving_or_incrementing() {
        var command = new CreateUserCommand(new Email("taken@example.com"), new UserName("Other"));
        when(repository.existsByEmail("taken@example.com")).thenReturn(true);

        var result = service.create(command);

        assertThat(result).isInstanceOf(CreateUserResult.DuplicateEmail.class);
        var dup = (CreateUserResult.DuplicateEmail) result;
        assertThat(dup.email()).isEqualTo("taken@example.com");
        verify(repository, never()).save(any(User.class));

        // Counter NOT incremented — duplicates do not count as "created".
        assertThat(registry.counter("users.created.total", "source", "api").count())
            .isEqualTo(0.0);
    }

    @Test
    void findByIdOrThrow_returns_user_when_present() {
        var user = new User("abc-123", "u@example.com", "U");
        when(repository.findById("abc-123")).thenReturn(Optional.of(user));

        assertThat(service.findByIdOrThrow("abc-123")).isSameAs(user);
    }

    @Test
    void findByIdOrThrow_throws_when_missing() {
        when(repository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.findByIdOrThrow("missing"))
            .isInstanceOf(UserNotFoundException.class)
            .hasMessageContaining("missing");
    }

    @Test
    void findById_returns_empty_when_not_present() {
        when(repository.findById(anyString())).thenReturn(Optional.empty());

        assertThat(service.findById("nope")).isEmpty();
    }

    @Test
    void list_delegates_to_repository_findAll_with_pageable() {
        var pageable = PageRequest.of(0, 20);
        var users = List.of(
            new User("1", "a@x.com", "A"),
            new User("2", "b@x.com", "B")
        );
        when(repository.findAll(pageable)).thenReturn(new PageImpl<>(users, pageable, users.size()));

        var page = service.list(pageable);

        assertThat(page.getContent()).containsExactlyElementsOf(users);
        assertThat(page.getTotalElements()).isEqualTo(2);
    }
}
