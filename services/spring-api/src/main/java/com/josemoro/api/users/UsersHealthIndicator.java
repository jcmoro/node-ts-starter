package com.josemoro.api.users;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Domain-level health indicator. Reports UP/OUT_OF_SERVICE/DOWN based on a
 * count() against the users table:
 *   - UP:             succeeds in &lt;= 500ms.
 *   - OUT_OF_SERVICE: succeeds but slower than 500ms.
 *   - DOWN:           throws (DB unreachable, schema missing, etc.).
 *
 * Exposed at /actuator/health/users when show-details is enabled. The DB
 * health indicator built into Spring Boot covers connectivity; this one is a
 * coarse readiness signal for the business domain.
 */
@Component
public class UsersHealthIndicator implements HealthIndicator {

    private static final long SLOW_THRESHOLD_MS = 500L;

    private final UserRepository repository;

    public UsersHealthIndicator(UserRepository repository) {
        this.repository = repository;
    }

    @Override
    public Health health() {
        var start = System.nanoTime();
        try {
            var count = repository.count();
            var elapsedMs = (System.nanoTime() - start) / 1_000_000L;

            var builder = (elapsedMs <= SLOW_THRESHOLD_MS) ? Health.up() : Health.outOfService();
            return builder
                .withDetail("users", count)
                .withDetail("latencyMs", elapsedMs)
                .withDetail("slowThresholdMs", SLOW_THRESHOLD_MS)
                .build();
        } catch (Exception ex) {
            return Health.down(ex).build();
        }
    }
}
