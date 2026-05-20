package com.josemoro.api.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class EmailTest {

    @Test
    void normalises_to_lowercase_and_trims_whitespace() {
        var email = new Email("  Jose@Example.COM  ");

        assertThat(email.value()).isEqualTo("jose@example.com");
        assertThat(email.toString()).isEqualTo("jose@example.com");
    }

    @Test
    void accepts_a_minimal_valid_email() {
        var email = new Email("a@b");

        assertThat(email.value()).isEqualTo("a@b");
    }

    @Test
    void rejects_null() {
        assertThatThrownBy(() -> new Email(null))
            .isInstanceOf(NullPointerException.class);
    }

    @Test
    void rejects_string_without_at() {
        assertThatThrownBy(() -> new Email("foo"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("invalid email");
    }

    @Test
    void rejects_too_short_value() {
        assertThatThrownBy(() -> new Email("@"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void equals_is_value_based() {
        var a = new Email("Foo@Example.com");
        var b = new Email("foo@example.com");

        assertThat(a).isEqualTo(b);   // post-normalisation
        assertThat(a.hashCode()).isEqualTo(b.hashCode());
    }
}
