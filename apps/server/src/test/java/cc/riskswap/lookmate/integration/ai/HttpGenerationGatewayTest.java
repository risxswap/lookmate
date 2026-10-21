package cc.riskswap.lookmate.integration.ai;

import static org.assertj.core.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class HttpGenerationGatewayTest {
    private HttpServer server;
    private String origin;
    private final AtomicInteger posts = new AtomicInteger();
    private final HttpGenerationGateway gateway = new HttpGenerationGateway();
    private static final byte[] PNG =
            Base64.getDecoder()
                    .decode(
                            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=");

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        origin = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext(
                "/reference",
                exchange -> {
                    exchange.sendResponseHeaders(200, PNG.length);
                    exchange.getResponseBody().write(PNG);
                    exchange.close();
                });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    Map<String, Object> config() {
        return new HashMap<>(
                Map.ofEntries(
                        Map.entry("planEndpoint", origin + "/plan"),
                        Map.entry("planModel", "fake"),
                        Map.entry("planApiKey", "test-key"),
                        Map.entry("imageEndpoint", origin + "/image"),
                        Map.entry("imageModel", "fake"),
                        Map.entry("imageApiKey", "test-key"),
                        Map.entry("imageParameters", Map.of()),
                        Map.entry("timeoutSeconds", 3),
                        Map.entry("maxResponseBytes", 100_000),
                        Map.entry("maxInputBytes", 100_000),
                        Map.entry("maxTextChars", 10_000),
                        Map.entry("planningMaxImages", 5),
                        Map.entry("imageMaxImages", 5)));
    }

    List<GenerationGateway.Image> images() {
        return List.of(new GenerationGateway.Image("person:1", origin + "/reference"));
    }

    void response(String path, int status, String value) {
        server.createContext(
                path,
                exchange -> {
                    posts.incrementAndGet();
                    exchange.getRequestBody().readAllBytes();
                    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status, bytes.length);
                    exchange.getResponseBody().write(bytes);
                    exchange.close();
                });
    }

    @Test
    void visionRequestAndResponseUseSingleCall() {
        response(
                "/plan",
                200,
                "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"{}\"}}]}");
        assertThat(gateway.plan(config(), "system", "data", images())).isEqualTo("{}");
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void malformedPlanDoesNotRetry() {
        response(
                "/plan",
                200,
                "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"{}\"}}]}");
        assertThatThrownBy(() -> gateway.plan(config(), "system", "data", images()))
                .hasMessage("PLAN_OUTPUT_INVALID");
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void imageMultipartGeneratesExactlyOneOutput() {
        server.createContext(
                "/image",
                exchange -> {
                    posts.incrementAndGet();
                    String request =
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.ISO_8859_1);
                    assertThat(request)
                            .contains("name=\"image[]\"", "name=\"n\"\r\n\r\n1", "person:1");
                    byte[] response =
                            ("{\"data\":[{\"b64_json\":\""
                                            + Base64.getEncoder().encodeToString(PNG)
                                            + "\"}]}")
                                    .getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        assertThat(gateway.generate(config(), "draw", images())).isEqualTo(PNG);
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void serverErrorIsUnknownWithoutRetry() {
        response("/image", 502, "bad gateway");
        assertThatThrownBy(() -> gateway.generate(config(), "draw", images()))
                .isInstanceOfSatisfying(
                        GenerationFailure.class, e -> assertThat(e.isUncertain()).isTrue());
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void explicitRejectionIsKnownFailure() {
        response("/image", 400, "invalid request");
        assertThatThrownBy(() -> gateway.generate(config(), "draw", images()))
                .isInstanceOfSatisfying(
                        GenerationFailure.class,
                        e -> {
                            assertThat(e.isUncertain()).isFalse();
                            assertThat(e.getCode()).isEqualTo("IMAGE_PROVIDER_FAILED");
                        });
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void invalidGeneratedImageRemainsUnknown() {
        response("/image", 200, "{\"data\":[{\"b64_json\":\"bm90IGFuIGltYWdl\"}]}");
        assertThatThrownBy(() -> gateway.generate(config(), "draw", images()))
                .isInstanceOfSatisfying(
                        GenerationFailure.class, e -> assertThat(e.isUncertain()).isTrue());
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void inputLimitsAndReservedParametersFailBeforePost() {
        var config = config();
        config.put("imageParameters", Map.of("n", 2));
        assertThatThrownBy(() -> gateway.generate(config, "draw", images()))
                .hasMessage("GENERATION_UNAVAILABLE");
        config.put("imageParameters", Map.of());
        config.put("maxInputBytes", 10);
        assertThatThrownBy(() -> gateway.generate(config, "draw", images()))
                .hasMessage("INPUT_BUDGET_EXCEEDED");
        assertThat(posts.get()).isZero();
    }

    @Test
    void oversizedPlanningResponseIsInvalidWithoutRetry() {
        response("/plan", 200, "x".repeat(1000));
        var config = config();
        config.put("maxResponseBytes", 100);
        assertThatThrownBy(() -> gateway.plan(config, "system", "data", images()))
                .isInstanceOfSatisfying(
                        GenerationFailure.class,
                        e -> {
                            assertThat(e.getCode()).isEqualTo("PLAN_OUTPUT_INVALID");
                            assertThat(e.isUncertain()).isFalse();
                        });
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void outputDownloadFailureDoesNotAuthorizeRegeneration() {
        response(
                "/image",
                200,
                "{\"data\":[{\"url\":\"http://169.254.169.254/latest/meta-data\"}]}");
        assertThatThrownBy(() -> gateway.generate(config(), "draw", images()))
                .isInstanceOfSatisfying(
                        GenerationFailure.class, e -> assertThat(e.isUncertain()).isTrue());
        assertThat(posts.get()).isEqualTo(1);
    }
}
