package com.josemoro.api.users;

/**
 * Discriminated union for the outcome of UserService.create.
 *
 * The sealed interface forces callers to handle every variant — adding a new
 * outcome here (e.g. Suspended) breaks the compilation of switches downstream
 * until they cover the new case. That is the point: domain outcomes are
 * data, not control flow exceptions.
 *
 * Compare with the exception-based style for findByIdOrThrow: throwing fits
 * "not found" because it is rare and propagates trivially through any depth;
 * sealed results fit "create" because duplicate-email is expected and the
 * caller must decide what to do (409, retry with suggestion, queue, etc.).
 */
public sealed interface CreateUserResult
    permits CreateUserResult.Created, CreateUserResult.DuplicateEmail {

    record Created(User user) implements CreateUserResult {}
    record DuplicateEmail(String email) implements CreateUserResult {}
}
