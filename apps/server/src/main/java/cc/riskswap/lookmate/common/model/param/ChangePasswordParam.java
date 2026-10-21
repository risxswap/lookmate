package cc.riskswap.lookmate.common.model.param;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.util.Map;
import java.util.Set;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

@Getter
@RequiredArgsConstructor
public final class ChangePasswordParam {
    private static final JsonMapper JSON =
            JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final String currentPassword;
    private final String newPassword;

    public static ChangePasswordParam parse(String body) {
        try {
            Object value = JSON.readValue(body, Object.class);
            if (!(value instanceof Map<?, ?> fields)
                    || !fields.keySet().equals(Set.of("currentPassword", "newPassword"))
                    || !(fields.get("currentPassword") instanceof String current)
                    || !(fields.get("newPassword") instanceof String next)) {
                throw invalid();
            }
            return new ChangePasswordParam(current, next);
        } catch (tools.jackson.core.JacksonException exception) {
            throw invalid();
        }
    }

    private static ApiException invalid() {
        return new ApiException(400, "VALIDATION_ERROR", "请提供原密码和新密码，且仅使用字符串字段");
    }
}
