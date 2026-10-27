package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.RecognitionProperties;
import cc.riskswap.lookmate.integration.ai.ModelProtocols;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
@RequiredArgsConstructor
public class RecognitionAvailability {
    private final RecognitionProperties properties;
    private final ObjectStorage storage;
    private final ObjectMapper json;

    public boolean available() {
        return properties.isEnabled()
                && !properties.getApiKey().isBlank()
                && !properties.getModel().isBlank()
                && !properties.getProvider().isBlank()
                && ModelProtocols.CHAT.equals(properties.getProtocol())
                && ModelProtocols.validEndpoint(properties.getEndpoint())
                && storage.available();
    }

    public String configSnapshot() {
        return json.writeValueAsString(
                Map.of(
                        "configVersion",
                        1,
                        "model",
                        properties.getModel(),
                        "endpoint",
                        properties.getEndpoint(),
                        "provider",
                        properties.getProvider(),
                        "protocol",
                        properties.getProtocol(),
                        "promptVersion",
                        2,
                        "maxImages",
                        properties.getMaxImages()));
    }
}
