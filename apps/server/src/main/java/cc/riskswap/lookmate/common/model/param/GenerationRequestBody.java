package cc.riskswap.lookmate.common.model.param;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

public final class GenerationRequestBody {
    private static final int LIMIT_BYTES = 32 * 1024;
    private static final JsonMapper JSON =
            JsonMapper.builder()
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();

    private GenerationRequestBody() {}

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parse(InputStream input) throws IOException {
        byte[] bytes = input.readNBytes(LIMIT_BYTES + 1);
        if (bytes.length > LIMIT_BYTES)
            throw new ApiException(413, "REQUEST_TOO_LARGE", "设计请求超过大小限制");
        try {
            if (JSON.readValue(bytes, Object.class) instanceof Map<?, ?> fields)
                return (Map<String, Object>) fields;
        } catch (JacksonException ignored) {
            // Malformed input uses the same response as a non-object JSON value.
        }
        throw new ApiException(400, "VALIDATION_ERROR", "设计请求JSON不合法");
    }
}
