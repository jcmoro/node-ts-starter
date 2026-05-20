package com.josemoro.api.users;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Request DTO for POST /users. Validated by jakarta.validation when annotated
 * with @Valid in the controller. The node-api equivalent uses Zod's
 * CreateUserSchema in src/domain/user.ts.
 */
public record CreateUserRequest(
    @Email @NotBlank String email,
    @NotBlank String name
) {}
