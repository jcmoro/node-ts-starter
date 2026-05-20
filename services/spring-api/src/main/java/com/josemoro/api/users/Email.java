package com.josemoro.api.users;

import java.util.Objects;

/**
 * Email value object. Smart constructor pattern:
 *   - Normalises (trim + lowercase) so equality and lookups are canonical.
 *   - Rejects null and structurally invalid values.
 *
 * After construction, the instance is guaranteed to be a normalised email.
 * No downstream code needs to repeat the validation or normalisation.
 */
public record Email(String value) {

    public Email {
        Objects.requireNonNull(value, "email value");
        value = value.trim().toLowerCase();
        if (!value.contains("@") || value.length() < 3) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
