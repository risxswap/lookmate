package cc.riskswap.lookmate.integration.ai;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.config.RecognitionProperties;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class HttpRecognitionGatewayTest {
    @Test
    void configuredEndpointModelAndCredentialReachSelectedProviderOnly() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var count = new AtomicInteger();
        server.createContext(
                "/alternate",
                exchange -> {
                    count.incrementAndGet();
                    assertThat(exchange.getRequestHeaders().getFirst("Authorization"))
                            .isEqualTo("Bearer test-recognition");
                    String request =
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.UTF_8);
                    assertThat(request).contains("deepseek-ai/DeepSeek-V4.1-Flash", "image_url");
                    byte[] response =
                            "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"{\\\"images\\\":[{\\\"imageId\\\":\\\"1\\\",\\\"features\\\":{}}]}\"}}]}"
                                    .getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            var p = new RecognitionProperties();
            p.setApiKey("test-recognition");
            p.setEndpoint("http://127.0.0.1:" + server.getAddress().getPort() + "/alternate");
            var gateway = new HttpRecognitionGateway(p, JsonMapper.builder().build());
            var images =
                    List.of(new RecognitionGateway.Image("1", "https://images.example/reference"));
            assertThat(gateway.recognize(p.getModel(), images).features()).containsKey("1");
            p.setProtocol("unsupported");
            assertThatThrownBy(() -> gateway.recognize(p.getModel(), images))
                    .hasMessage("RECOGNITION_UNAVAILABLE");
            p.setProtocol("openai-chat");
            p.setApiKey("");
            assertThatThrownBy(() -> gateway.recognize(p.getModel(), images))
                    .hasMessage("RECOGNITION_UNAVAILABLE");
            assertThat(count.get()).isEqualTo(1);
        } finally {
            server.stop(0);
        }
    }
}
