package cc.riskswap.lookmate.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties("lookmate.recognition")
@Getter
@Setter
public class RecognitionProperties {
    private String apiKey = "";
    private String provider = "siliconflow";
    private String protocol = "openai-chat";
    private String endpoint = "https://api.siliconflow.cn/v1/chat/completions";
    private String model = "deepseek-ai/DeepSeek-V4.1-Flash";
    private boolean enabled = false;
    private int timeoutSeconds = 120;
    private int concurrency = 1;
    private int providerConcurrency = 2;
    private int maxImages = 10;
    // Conservative development limits; tune after provider verification.
    private int pendingLimit = 100;
    private int userPendingLimit = 20;
}
