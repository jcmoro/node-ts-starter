package com.josemoro.api.users;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;

@Service
public class UserService {

    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    public User create(CreateUserRequest request) {
        var user = new User(UUID.randomUUID().toString(), request.email(), request.name());
        return repository.save(user);
    }

    public List<User> list() {
        return repository.findAll();
    }

    public Optional<User> findById(String id) {
        return repository.findById(id);
    }
}
