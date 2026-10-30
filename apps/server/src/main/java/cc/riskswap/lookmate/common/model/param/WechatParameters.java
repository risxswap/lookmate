package cc.riskswap.lookmate.common.model.param;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.util.*;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

public final class WechatParameters {
    private static final JsonMapper JSON =
            JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    private WechatParameters() {}

    public static JsonNode parse(String body, String... fields) {
        try {
            JsonNode n = JSON.readTree(body);
            Set<String> allowed = Set.of(fields);
            if (n == null || !n.isObject()) throw invalid();
            for (String key : n.propertyNames()) if (!allowed.contains(key)) throw invalid();
            return n;
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            throw invalid();
        }
    }

    public static String text(JsonNode n, String field, int max) {
        JsonNode value = n.get(field);
        if (value == null
                || !value.isString()
                || value.asText().isBlank()
                || value.asText().length() > max) throw invalid();
        return value.asText();
    }

    public static String password(JsonNode node) {
        JsonNode value = node.get("password");
        if (value == null || !value.isString()) throw invalid();
        String password = value.asText();
        if (password.codePointCount(0, password.length()) > 64) throw invalid();
        return password;
    }

    public static void empty(String body) {
        parse(body);
    }

    private static ApiException invalid() {
        return new ApiException(400, "VALIDATION_ERROR", "请求参数不正确");
    }
}
