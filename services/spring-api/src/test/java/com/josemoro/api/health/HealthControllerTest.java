package com.josemoro.api.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Demonstrates the value of the Clock bean: by overriding it via
 * @TestConfiguration with Clock.fixed(...), the /health endpoint becomes
 * deterministic in tests — its timestamp is exactly the fixed instant.
 */
@WebMvcTest(HealthController.class)
@Import({com.josemoro.api.security.SecurityConfig.class, HealthControllerTest.FixedClockConfig.class})
class HealthControllerTest {

    static final Instant FIXED_INSTANT = Instant.parse("2026-01-15T12:30:00Z");

    @TestConfiguration
    static class FixedClockConfig {
        @Bean Clock clock() {
            return Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC);
        }
    }

    @Autowired MockMvc mockMvc;

    @Test
    void health_returns_ok_with_fixed_timestamp() throws Exception {
        mockMvc.perform(get("/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ok"))
            .andExpect(jsonPath("$.ts").value(FIXED_INSTANT.toString()));
    }
}
