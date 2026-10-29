package cc.riskswap.lookmate.integration.ai;

import java.util.List;
import java.util.Map;
import lombok.Getter;

/** One supplier request per method; callers own durable state and recovery. */
public interface GenerationGateway {
    @Getter
    final class Image {
        private final String imageId;
        private final String url;
        private final byte[] bytes;

        public Image(String imageId, String url) {
            this.imageId = imageId;
            this.url = url;
            this.bytes = null;
        }

        /** Trusted platform resource bytes; never constructed from arbitrary client payloads. */
        public Image(String imageId, byte[] bytes) {
            this.imageId = imageId;
            this.url = null;
            this.bytes = bytes.clone();
        }
    }

    String plan(
            Map<String, Object> config, String systemPrompt, String userPrompt, List<Image> images);

    byte[] generate(Map<String, Object> config, String prompt, List<Image> images);
}
