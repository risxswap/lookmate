package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.AuthProperties;
import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthRateLimiter {
    private final AuthProperties properties;
    private final Clock clock;
    private final Map<String, Window> windows = new HashMap<>();

    public synchronized void request(String ip, boolean registration) {
        consume(
                (registration ? "register:" : "login:") + ip,
                registration ? properties.getRegistrationRequests() : properties.getLoginRequests(),
                registration ? properties.getRegistrationWindow() : properties.getLoginWindow());
    }

    public synchronized void checkFailure(String ip, String username) {
        checkFailureKey(failureKey(ip, username));
    }

    private void checkFailureKey(String key) {
        Window window = current(key);
        if (window != null && window.count >= properties.getFailedAttempts()) {
            throw limited(window.expiresAt);
        }
    }

    public synchronized void failed(String ip, String username) {
        failedKey(failureKey(ip, username));
    }

    private void failedKey(String key) {
        Window window = current(key);
        if (window == null) {
            window = create(key, properties.getFailureWindow());
        }
        if (window.count >= properties.getFailedAttempts()) {
            throw limited(window.expiresAt);
        }
        window.count++;
        if (window.count >= properties.getFailedAttempts()) {
            window.expiresAt = clock.millis() + properties.getLockDuration().toMillis();
            throw limited(window.expiresAt);
        }
    }

    public synchronized void succeeded(String ip, String username) {
        // 并发密码验证期间若已触发暂停，正确密码也不能绕过暂停。
        checkFailure(ip, username);
        windows.remove(failureKey(ip, username));
    }

    public synchronized void passwordRequest(String ip) {
        consume("password:" + ip, properties.getLoginRequests(), properties.getLoginWindow());
    }

    public synchronized void checkPasswordFailure(String ip, String userId) {
        checkFailureKey("password-failure:" + ip + ":" + userId);
    }

    public synchronized void passwordFailed(String ip, String userId) {
        failedKey("password-failure:" + ip + ":" + userId);
    }

    public synchronized void passwordSucceeded(String ip, String userId) {
        checkPasswordFailure(ip, userId);
        windows.remove("password-failure:" + ip + ":" + userId);
    }

    private void consume(String key, int limit, Duration duration) {
        Window window = current(key);
        if (window == null) {
            window = create(key, duration);
        }
        if (window.count >= limit) {
            throw limited(window.expiresAt);
        }
        window.count++;
    }

    private Window current(String key) {
        Window window = windows.get(key);
        if (window != null && window.expiresAt <= clock.millis()) {
            windows.remove(key);
            return null;
        }
        return window;
    }

    private Window create(String key, Duration duration) {
        if (windows.size() >= properties.getMaxRateEntries()) {
            long now = clock.millis();
            windows.values().removeIf(window -> window.expiresAt <= now);
            if (windows.size() >= properties.getMaxRateEntries()) {
                throw new ApiException(503, "SERVICE_UNAVAILABLE", "服务繁忙，请稍后重试");
            }
        }
        Window window = new Window(clock.millis() + duration.toMillis());
        windows.put(key, window);
        return window;
    }

    private ApiException limited(long expiresAt) {
        long seconds = Math.max(1, (expiresAt - clock.millis() + 999) / 1000);
        return new ApiException(429, "RATE_LIMITED", "操作过于频繁，请稍后重试", seconds);
    }

    private String failureKey(String ip, String username) {
        return "failure:" + ip + ":" + username;
    }

    private static final class Window {
        private int count;
        private long expiresAt;

        private Window(long expiresAt) {
            this.expiresAt = expiresAt;
        }
    }
}
