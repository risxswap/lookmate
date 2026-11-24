package cc.riskswap.lookmate.common.model.param;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GenerationRequestBodyTest {
    private Map<String, Object> parse(String body) throws IOException {
        return GenerationRequestBody.parse(
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void acceptsAnObjectAtTheByteLimitAndRejectsOneExtraByte() throws IOException {
        String body = "{\"name\":\"衣服\"}";
        int spaces = 32 * 1024 - body.getBytes(StandardCharsets.UTF_8).length;
        String full = body + " ".repeat(spaces);
        assertThat(parse(full)).containsExactlyEntriesOf(Map.of("name", "衣服"));
        assertThatThrownBy(() -> parse(full + " "))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> {
                            assertThat(e.getStatus()).isEqualTo(413);
                            assertThat(e.getCode()).isEqualTo("REQUEST_TOO_LARGE");
                        });
    }

    @Test
    void requiresASingleObjectWithDistinctKeysAtEveryLevel() {
        for (String value :
                new String[] {"null", "[]", "{}{}", "{\"input\":{\"mode\":1,\"mode\":2}}"}) {
            assertThatThrownBy(() -> parse(value))
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            e -> {
                                assertThat(e.getStatus()).isEqualTo(400);
                                assertThat(e.getCode()).isEqualTo("VALIDATION_ERROR");
                            });
        }
    }
}
