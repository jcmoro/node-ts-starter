package com.josemoro.api.users;

/**
 * Internal command sent to UserService.create. Wraps validated value objects
 * (Email, UserName) so the service layer cannot accept structurally invalid
 * input. Not exposed to the HTTP layer — that uses CreateUserRequest
 * (raw strings + Bean Validation).
 */
public record CreateUserCommand(Email email, UserName name) {}
