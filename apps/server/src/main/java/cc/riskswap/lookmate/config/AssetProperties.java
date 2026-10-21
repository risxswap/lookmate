package cc.riskswap.lookmate.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Conservative development budgets; provider acceptance still requires integration verification. */
@Component
@ConfigurationProperties("lookmate.assets")
@Getter
@Setter
public class AssetProperties {
    private String accessKey = "";
    private String secretKey = "";
    private String bucket = "";
    private String downloadDomain = "";
    private String uploadUrl = "";
    private int tokenSeconds = 600;
    private int accessSeconds = 300;
    private int processingConcurrency = 1;
    private int pendingLimit = 100;
    private int userPendingLimit = 20;
    private int verificationLeaseSeconds = 300;
    private int retryDelaySeconds = 60;
    private boolean maintenance = false;
}
