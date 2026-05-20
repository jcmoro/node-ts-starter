package com.josemoro.api.audit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import com.josemoro.api.users.User;

/**
 * Fire-and-forget audit log. With @EnableAsync (in AppConfig) and
 * spring.threads.virtual.enabled=true, calls to recordUserCreated run on a
 * virtual thread without blocking the calling request thread.
 *
 * The artificial 100 ms sleep makes the desacople visible: a POST /users
 * still returns in &lt;50 ms while this method finishes around 100 ms later.
 *
 * In a real system this would persist to an audit table, push to Kafka, or
 * call a SIEM. The signature stays trivial: void + @Async = caller gets no
 * confirmation, errors are logged and not propagated.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    @Async
    public void recordUserCreated(User user) {
        try {
            Thread.sleep(100);   // simulate downstream call (writeI/O, SIEM, queue, ...)
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return;
        }
        log.info("audit: user.created id={} email={} thread={}",
            user.getId(), user.getEmail(), Thread.currentThread());
    }
}
