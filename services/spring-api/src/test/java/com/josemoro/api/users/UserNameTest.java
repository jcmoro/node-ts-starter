package com.josemoro.api.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class UserNameTest {

    @Test
    void strips_surrounding_whitespace() {
        assertThat(new UserName("  Jose  ").value()).isEqualTo("Jose");
    }

    @Test
    void preserves_inner_whitespace() {
        assertThat(new UserName("Jose Moro").value()).isEqualTo("Jose Moro");
    }

    @Test
    void rejects_null() {
        assertThatThrownBy(() -> new UserName(null))
            .isInstanceOf(NullPointerException.class);
    }

    @Test
    void rejects_blank() {
        assertThatThrownBy(() -> new UserName("   "))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must not be blank");
    }

    @Test
    void rejects_too_long() {
        var tooLong = "x".repeat(UserName.MAX_LENGTH + 1);

        assertThatThrownBy(() -> new UserName(tooLong))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("too long");
    }

    @Test
    void accepts_max_length() {
        var exactlyMax = "x".repeat(UserName.MAX_LENGTH);

        assertThat(new UserName(exactlyMax).value()).hasSize(UserName.MAX_LENGTH);
    }
}
