package com.josemoro.api.users;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.josemoro.api.audit.AuditService;

import io.micrometer.core.annotation.Timed;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.observation.annotation.Observed;

@Service
public class UserService {

    private final UserRepository repository;
    private final AuditService audit;
    private final Counter usersCreated;
    private final Timer userCreationDuration;

    public UserService(UserRepository repository, AuditService audit, MeterRegistry registry) {
        this.repository = repository;
        this.audit = audit;
        this.usersCreated = Counter.builder("users.created.total")
            .description("Total users successfully created via the API")
            .tag("source", "api")
            .register(registry);
        this.userCreationDuration = Timer.builder("users.creation.duration")
            .description("Time to process a user creation request, including duplicate-check and save")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
    }

    /**
     * Creates a user. Returns a sealed CreateUserResult so the caller can
     * react to expected domain outcomes (duplicate email) without exceptions
     * for control flow.
     *
     * Instrumentation:
     *   - @Observed creates an OTel span via Micrometer Tracing bridge.
     *   - The injected Timer records duration with percentiles for Prometheus.
     *   - The Counter increments on every successful creation (DuplicateEmail
     *     does NOT count toward "created").
     */
    @Observed(name = "users.create", contextualName = "create-user")
    @Transactional
    public CreateUserResult create(CreateUserCommand command) {
        return userCreationDuration.record(() -> {
            var email = command.email().value();
            if (repository.existsByEmail(email)) {
                return new CreateUserResult.DuplicateEmail(email);
            }
            var user = new User(UUID.randomUUID().toString(), email, command.name().value());
            var saved = repository.save(user);
            usersCreated.increment();
            // Fire-and-forget: returns immediately, audit happens on a virtual
            // thread without blocking the HTTP response.
            audit.recordUserCreated(saved);
            return new CreateUserResult.Created(saved);
        });
    }

    @Timed(value = "users.list.duration", description = "Time to list users with pagination")
    @Transactional(readOnly = true)
    public Page<User> list(Pageable pageable) {
        return repository.findAll(pageable);
    }

    @Transactional(readOnly = true)
    public Optional<User> findById(String id) {
        return repository.findById(id);
    }

    /**
     * Strict variant of findById that throws when the user does not exist.
     * Use in controllers where 404 is the desired response. The advice in
     * com.josemoro.api.errors.ApiExceptionHandler maps the exception to HTTP.
     */
    @Transactional(readOnly = true)
    public User findByIdOrThrow(String id) {
        return repository.findById(id).orElseThrow(() -> new UserNotFoundException(id));
    }

    /**
     * Deletes a user by id. Throws UserNotFoundException (→ 404 via the
     * advice) when no row matches, so the caller distinguishes "deleted"
     * from "already gone".
     */
    @Transactional
    public void deleteById(String id) {
        if (!repository.existsById(id)) {
            throw new UserNotFoundException(id);
        }
        repository.deleteById(id);
    }
}
