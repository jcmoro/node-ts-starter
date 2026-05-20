package com.josemoro.api.security;

import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.config.http.SessionCreationPolicy.STATELESS;

import java.time.Duration;
import java.util.List;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Stateless API security:
 *   - /health, /actuator/health/**, /actuator/info, /actuator/prometheus → public.
 *   - /users/** → authenticated (HTTP Basic).
 *   - DELETE /users/{id} → requires ROLE_ADMIN via @PreAuthorize on the
 *     controller method (enabled by @EnableMethodSecurity).
 *
 * CSRF is disabled because the API is stateless with no cookie-based session.
 * CORS is opened to the local Vite dev server (port 5173).
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(
                    "/health",
                    "/actuator/health/**",
                    "/actuator/info",
                    "/actuator/prometheus"
                ).permitAll()
                .anyRequest().authenticated()
            )
            .httpBasic(withDefaults())
            .build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        var cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(List.of("http://localhost:5173", "http://127.0.0.1:5173"));
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-Id"));
        cfg.setAllowCredentials(true);
        cfg.setMaxAge(Duration.ofHours(1));

        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);
        return source;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // bcrypt cost 12 — ~250ms per hash on modern hardware.
        return new BCryptPasswordEncoder(12);
    }

    /**
     * In-memory user store for demo / local dev. In production this would be
     * replaced by a JDBC- or LDAP-backed UserDetailsService, or removed
     * entirely in favour of an OAuth2 Resource Server with JWT tokens.
     */
    @Bean
    public UserDetailsService userDetailsService(PasswordEncoder encoder) {
        var alice = User.withUsername("alice")
            .password(encoder.encode("alice-secret"))
            .roles("USER")
            .build();
        var admin = User.withUsername("admin")
            .password(encoder.encode("admin-secret"))
            .roles("USER", "ADMIN")
            .build();
        return new InMemoryUserDetailsManager(alice, admin);
    }
}
