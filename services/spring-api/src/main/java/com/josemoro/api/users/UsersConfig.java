package com.josemoro.api.users;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Typed config for the users module. Bound from application.yml under
 * the prefix `app.users`. Validation runs at startup — invalid values
 * (e.g. zero or negative page sizes) make the app fail fast instead of
 * silently degrading at request time.
 */
@ConfigurationProperties(prefix = "app.users")
@Validated
public record UsersConfig(
    @Min(1) int defaultPageSize,
    @Min(1) @Max(200) int maxPageSize
) {}
