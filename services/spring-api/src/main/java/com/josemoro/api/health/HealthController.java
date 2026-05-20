package com.josemoro.api.health;

import java.time.Instant;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Plain /health endpoint that mirrors the node-api shape:
 *   { "status": "ok", "ts": "<ISO>" }
 *
 * Spring Boot Actuator already exposes /actuator/health with a richer payload,
 * but we keep this one so the web frontend can hit a stable URL regardless of
 * which backend is selected.
 */
@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of(
            "status", "ok",
            "ts", Instant.now().toString()
        );
    }
}
