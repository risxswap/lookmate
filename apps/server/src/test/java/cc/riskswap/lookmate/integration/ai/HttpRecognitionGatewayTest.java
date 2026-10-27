package cc.riskswap.lookmate.integration.ai;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.config.RecognitionProperties;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.json.JsonMapper;

@ExtendWith(OutputCaptureExtension.class)
class HttpRecognitionGatewayTest {
    @Test
    void configuredEndpointModelAndCredentialReachSelectedProviderOnly(CapturedOutput output)
            throws Exception {
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
                    assertThat(request)
                            .contains(
                                    "deepseek-ai/DeepSeek-V4.1-Flash",
                                    "image_url",
                                    "All natural-language feature values must be in Simplified Chinese",
                                    "Keep JSON field names and viewType enum values exactly as specified in English");
                    var mapper = JsonMapper.builder().build();
                    String content =
                            mapper.writeValueAsString(
                                    Map.of(
                                            "images",
                                            List.of(
                                                    Map.of(
                                                            "imageId",
                                                            "1",
                                                            "features",
                                                            Map.of(
                                                                    "viewType",
                                                                    "FRONT",
                                                                    "description",
                                                                    "浅色长款风衣",
                                                                    "colors",
                                                                    List.of("米色"),
                                                                    "details",
                                                                    Map.of("neckline", "翻领"))))));
                    byte[] response =
                            mapper.writeValueAsBytes(
                                    Map.of(
                                            "choices",
                                            List.of(
                                                    Map.of(
                                                            "finish_reason",
                                                            "stop",
                                                            "message",
                                                            Map.of("content", content)))));
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
            assertThat(gateway.recognize(p.getModel(), images).features().get("1"))
                    .containsEntry("viewType", "FRONT")
                    .containsEntry("description", "浅色长款风衣")
                    .containsEntry("colors", List.of("米色"))
                    .containsEntry("details", Map.of("neckline", "翻领"));
            assertThat(output.getOut())
                    .contains("衣物识别模型响应", "httpStatus=200", "elapsedMs=")
                    .doesNotContain("test-recognition", "https://images.example/reference");
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
