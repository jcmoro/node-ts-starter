package com.josemoro.api.users;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Spring Data JPA derives a full CRUD implementation from this interface at
 * runtime. Compare with src/db/users.ts in node-api, which spells out each
 * query explicitly via the postgres.js tagged-template client.
 */
public interface UserRepository extends JpaRepository<User, String> {
}
