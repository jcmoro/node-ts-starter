package com.josemoro.api.users;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * JPA entity matching the `users` table defined in /migrations/0001_initial.sql.
 *
 * The schema uses TEXT (not UUID) for the id column for parity with the
 * node-api, which generates IDs via crypto.randomUUID() as strings. JPA needs
 * a mutable class with a no-arg constructor, so this stays as a class rather
 * than a record (records would be cleaner but JPA doesn't support them as
 * entities yet — only as DTO projections).
 */
@Entity
@Table(name = "users")
public class User {

    @Id
    @Column(nullable = false)
    private String id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String name;

    protected User() {
        // JPA no-arg constructor.
    }

    public User(String id, String email, String name) {
        this.id = id;
        this.email = email;
        this.name = name;
    }

    public String getId() { return id; }
    public String getEmail() { return email; }
    public String getName() { return name; }
}
