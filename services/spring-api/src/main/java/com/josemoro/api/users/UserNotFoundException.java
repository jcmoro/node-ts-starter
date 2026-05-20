package com.josemoro.api.users;

/**
 * Thrown when a user is requested by id and no row matches. The advice in
 * com.josemoro.api.errors.ApiExceptionHandler maps this to HTTP 404.
 */
public class UserNotFoundException extends RuntimeException {

    private final String userId;

    public UserNotFoundException(String userId) {
        super("User " + userId + " not found");
        this.userId = userId;
    }

    public String getUserId() {
        return userId;
    }
}
