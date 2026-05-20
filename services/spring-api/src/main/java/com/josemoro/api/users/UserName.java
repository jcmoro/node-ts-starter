package com.josemoro.api.users;

import java.util.Objects;

/**
 * User display name. Smart constructor pattern:
 *   - Strips surrounding whitespace.
 *   - Rejects null, empty, and too-long values.
 *
 * After construction, the instance is guaranteed to be a non-blank name
 * within domain length bounds.
 */
public record UserName(String value) {

    public static final int MAX_LENGTH = 100;

    public UserName {
        Objects.requireNonNull(value, "name value");
        value = value.strip();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("name must not be blank");
        }
        if (value.length() > MAX_LENGTH) {
            throw new IllegalArgumentException("name too long: " + value.length() + " > " + MAX_LENGTH);
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
