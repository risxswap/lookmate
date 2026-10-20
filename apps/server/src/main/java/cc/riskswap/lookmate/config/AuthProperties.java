package cc.riskswap.lookmate.config;

import java.time.Duration;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.validation.annotation.Validated;

@Getter
@Setter
@Validated
@ConfigurationProperties("lookmate.auth")
public class AuthProperties {
    private boolean registrationEnabled = false;
    @NotNull @DurationMin(seconds = 1)
    private Duration absoluteTimeout = Duration.ofDays(7);
    @Min(1) private int loginRequests = 30;
    @NotNull @DurationMin(seconds = 1)
    private Duration loginWindow = Duration.ofMinutes(1);
    @Min(1) private int registrationRequests = 10;
    @NotNull @DurationMin(seconds = 1)
    private Duration registrationWindow = Duration.ofHours(1);
    @Min(1) private int failedAttempts = 5;
    @NotNull @DurationMin(seconds = 1)
    private Duration failureWindow = Duration.ofMinutes(15);
    @NotNull @DurationMin(seconds = 1)
    private Duration lockDuration = Duration.ofMinutes(15);
    @Min(1) private int maxRateEntries = 10000;
}
