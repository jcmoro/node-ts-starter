package com.josemoro.api.users;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Spring Data JPA derives a full CRUD implementation from this interface at
 * runtime. The derived methods below are generated from their names:
 *   - findByEmail   → SELECT u FROM User u WHERE u.email = ?1
 *   - existsByEmail → SELECT count(u) > 0 FROM User u WHERE u.email = ?1
 */
public interface UserRepository extends JpaRepository<User, String> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);
}
