package com.josemoro.api.errors;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.josemoro.api.users.UserNotFoundException;

/**
 * Global exception handler for the API. Translates domain exceptions and
 * validation failures into RFC 9457 ProblemDetail responses with
 * Content-Type: application/problem+json.
 *
 * Logging policy:
 *   - 4xx (domain / client): INFO without stack trace.
 *   - 5xx (unexpected):       ERROR with stack trace.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private static final URI ERRORS_BASE = URI.create("https://docs.example.com/errors/");

    @ExceptionHandler(UserNotFoundException.class)
    public ProblemDetail userNotFound(UserNotFoundException ex) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setType(ERRORS_BASE.resolve("user-not-found"));
        problem.setTitle("User not found");
        problem.setProperty("userId", ex.getUserId());
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> validationFailed(MethodArgumentNotValidException ex) {
        List<Map<String, String>> fieldErrors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> Map.of(
                "field", fe.getField(),
                "message", fe.getDefaultMessage() == null ? "invalid" : fe.getDefaultMessage()
            ))
            .toList();

        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
            "One or more fields failed validation");
        problem.setType(ERRORS_BASE.resolve("validation-failed"));
        problem.setTitle("Validation failed");
        problem.setProperty("errors", fieldErrors);
        return ResponseEntity.badRequest().body(problem);
    }

    /**
     * Spring Security's @PreAuthorize raises AccessDeniedException when the
     * caller is authenticated but lacks the required authority. Without this
     * handler the fallback would map it to 500.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail accessDenied(AccessDeniedException ex) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN,
            "You do not have permission to perform this action");
        problem.setType(ERRORS_BASE.resolve("access-denied"));
        problem.setTitle("Access denied");
        return problem;
    }

    /**
     * Re-thrown so Spring Security's BasicAuthenticationEntryPoint can build
     * the proper 401 response with WWW-Authenticate. If we caught it here we
     * would shadow the canonical authentication failure handling.
     */
    @ExceptionHandler(AuthenticationException.class)
    public void authenticationFailed(AuthenticationException ex) throws AuthenticationException {
        throw ex;
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> fallback(Exception ex) {
        // 5xx — log with stack trace; never leak internals to the client.
        log.error("Unhandled exception", ex);
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR,
            "An unexpected error occurred.");
        problem.setType(ERRORS_BASE.resolve("internal"));
        problem.setTitle("Internal server error");
        return ResponseEntity.internalServerError().body(problem);
    }
}
