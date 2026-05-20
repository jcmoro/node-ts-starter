package com.josemoro.api.users;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.josemoro.api.errors.ApiExceptionHandler;
import com.josemoro.api.security.SecurityConfig;

@WebMvcTest(UserController.class)
@Import({ApiExceptionHandler.class, SecurityConfig.class, UserControllerTest.TestConfig.class})
@WithMockUser(username = "alice", roles = "USER")
class UserControllerTest {

    @TestConfiguration
    static class TestConfig {
        @Bean UsersConfig usersConfig() { return new UsersConfig(20, 100); }
    }

    @Autowired MockMvc mockMvc;

    @MockitoBean UserService service;

    @Test
    void post_users_returns_201_with_Location_when_created() throws Exception {
        var saved = new User("abc-123", "jose@example.com", "Jose");
        when(service.create(any(CreateUserCommand.class)))
            .thenReturn(new CreateUserResult.Created(saved));

        mockMvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email":"jose@example.com","name":"Jose"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(header().string("Location", "/users/abc-123"))
            .andExpect(jsonPath("$.id").value("abc-123"));
    }

    @Test
    void post_users_returns_409_problem_json_when_duplicate_email() throws Exception {
        when(service.create(any(CreateUserCommand.class)))
            .thenReturn(new CreateUserResult.DuplicateEmail("taken@example.com"));

        mockMvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email":"taken@example.com","name":"X"}
                    """))
            .andExpect(status().isConflict())
            .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
            .andExpect(jsonPath("$.title").value("Email already taken"))
            .andExpect(jsonPath("$.email").value("taken@example.com"));
    }

    @Test
    void post_users_returns_400_when_email_is_invalid() throws Exception {
        mockMvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email":"not-an-email","name":"Jose"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
            .andExpect(jsonPath("$.errors[*].field").value(org.hamcrest.Matchers.hasItem("email")));

        verify(service, never()).create(any());
    }

    @Test
    void post_users_returns_400_when_name_is_blank() throws Exception {
        mockMvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email":"ok@example.com","name":""}
                    """))
            .andExpect(status().isBadRequest());

        verify(service, never()).create(any());
    }

    @Test
    void get_users_id_returns_200_when_present() throws Exception {
        var user = new User("abc-123", "jose@example.com", "Jose");
        when(service.findByIdOrThrow("abc-123")).thenReturn(user);

        mockMvc.perform(get("/users/abc-123"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("jose@example.com"));
    }

    @Test
    void get_users_id_returns_404_problem_json_when_missing() throws Exception {
        when(service.findByIdOrThrow(anyString()))
            .thenThrow(new UserNotFoundException("missing"));

        mockMvc.perform(get("/users/missing"))
            .andExpect(status().isNotFound())
            .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
            .andExpect(jsonPath("$.userId").value("missing"));
    }

    @Test
    void get_users_returns_a_page() throws Exception {
        var users = List.of(
            new User("1", "a@x.com", "A"),
            new User("2", "b@x.com", "B")
        );
        when(service.list(any(Pageable.class)))
            .thenReturn(new PageImpl<>(users, PageRequest.of(0, 20), users.size()));

        mockMvc.perform(get("/users"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.content.length()").value(2))
            .andExpect(jsonPath("$.totalElements").value(2));
    }

    // ----- Security-focused tests -----

    @Test
    void get_users_returns_401_for_anonymous() throws Exception {
        mockMvc.perform(get("/users").with(anonymous()))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void delete_returns_401_for_anonymous() throws Exception {
        mockMvc.perform(delete("/users/abc-123").with(anonymous()))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void delete_returns_403_for_user_role() throws Exception {
        // The class-level @WithMockUser gives USER but not ADMIN;
        // @PreAuthorize on delete requires ADMIN → 403.
        mockMvc.perform(delete("/users/abc-123"))
            .andExpect(status().isForbidden());

        verify(service, never()).deleteById(anyString());
    }

    @Test
    void delete_succeeds_for_admin_role() throws Exception {
        mockMvc.perform(delete("/users/abc-123")
                .with(user("admin").roles("USER", "ADMIN")))
            .andExpect(status().isNoContent());

        verify(service).deleteById("abc-123");
    }
}
