package cc.riskswap.lookmate.integration.ai;

import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Getter;

/** One supplier request per method; callers own durable state and recovery. */
public interface GenerationGateway {
    @Getter
    @AllArgsConstructor
    final class Image {
        private final String imageId;
        private final String url;
    }

    String plan(
            Map<String, Object> config, String systemPrompt, String userPrompt, List<Image> images);

    byte[] generate(Map<String, Object> config, String prompt, List<Image> images);
}
