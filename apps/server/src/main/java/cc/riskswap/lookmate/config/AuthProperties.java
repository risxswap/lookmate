package cc.riskswap.lookmate.config;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Getter
@Setter
@Validated
@ConfigurationProperties("lookmate.auth")
public class AuthProperties {
    private boolean registrationEnabled = false;

    @NotNull
    @DurationMin(seconds = 1)
    private Duration absoluteTimeout = Duration.ofDays(7);

    @NotNull
    @DurationMin(seconds = 1)
    private Duration rememberMeTimeout = Duration.ofDays(30);

    @AssertTrue(message = "记住登录期限必须为 1～2147483647 的整数秒")
    public boolean isRememberMeTimeoutValid() {
        return rememberMeTimeout == null
                || (rememberMeTimeout.getNano() == 0
                        && rememberMeTimeout.getSeconds() >= 1
                        && rememberMeTimeout.getSeconds() <= Integer.MAX_VALUE);
    }

    @Min(1)
    private int loginRequests = 30;

    @NotNull
    @DurationMin(seconds = 1)
    private Duration loginWindow = Duration.ofMinutes(1);

    @Min(1)
    private int registrationRequests = 10;

    @NotNull
    @DurationMin(seconds = 1)
    private Duration registrationWindow = Duration.ofHours(1);

    @Min(1)
    private int failedAttempts = 5;

    @NotNull
    @DurationMin(seconds = 1)
    private Duration failureWindow = Duration.ofMinutes(15);

    @NotNull
    @DurationMin(seconds = 1)
    private Duration lockDuration = Duration.ofMinutes(15);

    @Min(1)
    private int maxRateEntries = 10000;
}
