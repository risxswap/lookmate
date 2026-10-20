package cc.riskswap.lookmate.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.config.AuthProperties;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class AuthRateLimiterTest {
    private final MutableClock clock = new MutableClock();
    private final AuthProperties properties = new AuthProperties();
    private final AuthRateLimiter limiter = new AuthRateLimiter(properties, clock);

    @Test
    void fifthFailureLocksOnlyThatIpAndUsernameAndRecoversAtDeadline() {
        for (int i = 0; i < 4; i++) limiter.failed("ip1", "alice");
        assertThatThrownBy(() -> limiter.failed("ip1", "alice")).isInstanceOfSatisfying(ApiException.class,
                error -> { assertThat(error.getStatus()).isEqualTo(429); assertThat(error.getRetryAfterSeconds()).isEqualTo(900); });
        limiter.checkFailure("ip2", "alice");
        limiter.checkFailure("ip1", "bob");
        clock.advance(Duration.ofSeconds(899));
        assertThatThrownBy(() -> limiter.succeeded("ip1", "alice")).isInstanceOf(ApiException.class);
        clock.advance(Duration.ofSeconds(1));
        limiter.checkFailure("ip1", "alice");
        limiter.failed("ip1", "alice");
    }

    @Test
    void successfulLoginResetsFailureCountAndExpiredFailuresDoNotAccumulate() {
        for (int i = 0; i < 4; i++) limiter.failed("ip", "alice");
        limiter.succeeded("ip", "alice");
        for (int i = 0; i < 4; i++) limiter.failed("ip", "alice");
        clock.advance(Duration.ofMinutes(15));
        limiter.failed("ip", "alice");
        limiter.checkFailure("ip", "alice");
    }

    @Test
    void requestWindowsAreIndependentAndRecover() {
        for (int i = 0; i < 30; i++) limiter.request("ip", false);
        assertThatThrownBy(() -> limiter.request("ip", false)).isInstanceOf(ApiException.class);
        for (int i = 0; i < 10; i++) limiter.request("ip", true);
        assertThatThrownBy(() -> limiter.request("ip", true)).isInstanceOf(ApiException.class);
        clock.advance(Duration.ofMinutes(1));
        limiter.request("ip", false);
        assertThatThrownBy(() -> limiter.request("ip", true)).isInstanceOf(ApiException.class);
        clock.advance(Duration.ofHours(1));
        limiter.request("ip", true);
    }

    @Test
    void fullCapacityRejectsNewKeysWithoutEvictingActiveRestrictions() {
        properties.setMaxRateEntries(1);
        limiter.request("ip", false);
        assertThatThrownBy(() -> limiter.request("other", false)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.getStatus()).isEqualTo(503));
        clock.advance(Duration.ofMinutes(1));
        limiter.request("other", false);
    }

    private static class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-20T00:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
