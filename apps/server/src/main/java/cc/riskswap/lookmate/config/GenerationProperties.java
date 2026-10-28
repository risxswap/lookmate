package cc.riskswap.lookmate.config;

import java.util.*;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties("lookmate.generation")
@Getter
@Setter
public class GenerationProperties {
    private String previewSecret = "";
    private String planProvider = "siliconflow";
    private String planProtocol = "openai-chat";
    private String planEndpoint = "https://api.siliconflow.cn/v1/chat/completions";
    private String planModel = "deepseek-ai/DeepSeek-V4.1-Flash";
    private String planApiKey = "";
    private String imageProvider = "siliconflow";
    private String imageProtocol = "siliconflow-images";
    private String imageEndpoint = "https://api.siliconflow.cn/v1/images/generations";
    private String imageModel = "Kwai-Kolors/Kolors";
    private String imageApiKey = "";
    private Map<String, Object> imageParameters = new LinkedHashMap<>();
    private Map<String, String> imageSizesByType = new LinkedHashMap<>();
    // Application limits for development; verify against the configured provider.
    private int planningMaxImages = 10;
    private int imageMaxImages = 10;
    private long maxInputBytes = 20971520;
    private int maxTextChars = 20000;
    private int maxResponseBytes = 20 * 1024 * 1024;
    private int timeoutSeconds = 180;
    private int candidateTarget = 24;
    private int wardrobeScanLimit = 500;
    private int pendingLimit = 100;
    private int concurrency = 2;
    private int historyLimit = 10;
    private String stagingDirectory = "./runtime/generation";
    private long minFreeBytes = 100 * 1024 * 1024;
    private int saveRetrySeconds = 30;
    private int previewSeconds = 600;
    // Old non-secret configurations are retained in task snapshots. Credentials are resolved by
    // endpoint|model, preventing cross-endpoint key reuse.
    private Map<String, String> planCredentials = new LinkedHashMap<>();
    private Map<String, String> imageCredentials = new LinkedHashMap<>();
}
