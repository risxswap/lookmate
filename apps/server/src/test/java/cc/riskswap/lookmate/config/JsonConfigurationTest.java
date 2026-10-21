package cc.riskswap.lookmate.config;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.model.param.CredentialsParam;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class JsonConfigurationTest {
    @Test
    void numericAndBooleanValuesCannotBecomeCredentials() {
        var builder = JsonMapper.builder();
        new JsonConfiguration().strictTextFields().customize(builder);
        var mapper = builder.build();
        for (String value : new String[] {"12345678", "true", "1.25"}) {
            assertThatThrownBy(
                            () ->
                                    mapper.readValue(
                                            "{\"username\":\"alice\",\"password\":" + value + "}",
                                            CredentialsParam.class))
                    .isInstanceOf(tools.jackson.core.JacksonException.class);
        }
        var credentials =
                mapper.readValue(
                        "{\"username\":\"alice\",\"password\":\" 12345678 \"}",
                        CredentialsParam.class);
        assertThat(credentials.getPassword()).isEqualTo(" 12345678 ");
    }
}
