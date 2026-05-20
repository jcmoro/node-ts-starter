package com.josemoro.api;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * Beans for things we do not own (third-party classes / JDK).
 *
 * @EnableAsync activates AOP processing for @Async methods. With
 * spring.threads.virtual.enabled=true the default Spring task executor
 * runs each @Async call on a fresh virtual thread — cheap, even at scale.
 *
 * Exposing Clock as a bean lets us inject a fixed clock in tests for
 * deterministic timestamps without touching production code.
 */
@Configuration
@EnableAsync
public class AppConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
