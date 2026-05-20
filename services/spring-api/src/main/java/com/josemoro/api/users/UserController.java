package com.josemoro.api.users;

import java.net.URI;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/users")
public class UserController {

    private final UserService service;
    private final UsersConfig usersConfig;

    public UserController(UserService service, UsersConfig usersConfig) {
        this.service = service;
        this.usersConfig = usersConfig;
    }

    /**
     * Lists users with pagination. The request size is silently capped to
     * usersConfig.maxPageSize() to protect the DB and the network. A more
     * permissive policy would reject the request with 400; we trade strictness
     * for ergonomics here.
     */
    @GetMapping
    public Page<User> list(Pageable pageable) {
        var cappedSize = Math.min(pageable.getPageSize(), usersConfig.maxPageSize());
        var safe = PageRequest.of(pageable.getPageNumber(), cappedSize, pageable.getSort());
        return service.list(safe);
    }

    @GetMapping("/{id}")
    public User getById(@PathVariable String id) {
        // Delegates "not found" to UserNotFoundException → 404 via the advice.
        return service.findByIdOrThrow(id);
    }

    /**
     * Admin-only endpoint demonstrating method-level security with SpEL.
     * @PreAuthorize is evaluated by Spring Security before the method runs;
     * unauthenticated requests get 401, authenticated-but-not-admin get 403.
     */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('ADMIN')")
    public void delete(@PathVariable String id) {
        service.deleteById(id);
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody CreateUserRequest request) {
        // Build the domain command from the HTTP DTO. The value-object
        // constructors guarantee structural validity at the service boundary.
        var command = new CreateUserCommand(
            new Email(request.email()),
            new UserName(request.name())
        );

        return switch (service.create(command)) {
            case CreateUserResult.Created(User user) ->
                ResponseEntity.created(URI.create("/users/" + user.getId())).body(user);
            case CreateUserResult.DuplicateEmail(String email) -> {
                var pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
                    "Email is already registered");
                pd.setType(URI.create("https://docs.example.com/errors/email-already-taken"));
                pd.setTitle("Email already taken");
                pd.setProperty("email", email);
                yield ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
            }
        };
    }
}
