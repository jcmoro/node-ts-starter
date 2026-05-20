package com.josemoro.api.health;

import java.time.Clock;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Plain /health endpoint that returns { status, ts }. Uses an injected Clock
 * so tests can pin the timestamp deterministically (see HealthControllerTest).
 *
 * Note: Spring Boot Actuator already exposes /actuator/health with a richer
 * payload. This endpoint exists for clients that want a stable, minimal
 * health URL independent of Actuator's contract.
 */
@RestController
public class HealthController {

    private final Clock clock;

    public HealthController(Clock clock) {
        this.clock = clock;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of(
            "status", "ok",
            "ts", clock.instant().toString()
        );
    }
}
