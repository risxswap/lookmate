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
    private boolean enabled = false;
    private boolean budgetsVerified = false;
    private String previewSecret = "";
    private String planEndpoint = "https://api.deepseek.com/chat/completions";
    private String planModel = "";
    private String planApiKey = "";
    private String imageEndpoint = "";
    private String imageModel = "";
    private String imageApiKey = "";
    private Map<String, Object> imageParameters = new LinkedHashMap<>();
    private int planningMaxImages = 0;
    private int imageMaxImages = 0;
    private long maxInputBytes = 0;
    private int maxTextChars = 0;
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
