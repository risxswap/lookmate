package cc.riskswap.lookmate.integration.ai;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.util.GenerationLog;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

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
                    String request =
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.UTF_8);
                    if (path.equals("/plan")) {
                        assertThat(request).contains("\"model\":\"fake\"", "image_url");
                        assertThat(exchange.getRequestHeaders().getFirst("Authorization"))
                                .isEqualTo("Bearer test-key");
                    }
                    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status, bytes.length);
                    exchange.getResponseBody().write(bytes);
                    exchange.close();
                });
    }

    @Test
    void logsHttpFailureWithTaskCorrelationWithoutPrivatePayloads() {
        response("/image", 503, "private-provider-error secret-api-key secret-prompt");
        var logger = (Logger) LoggerFactory.getLogger(GenerationLog.class);
        var capture = new ListAppender<ILoggingEvent>();
        capture.start();
        logger.addAppender(capture);
        var config = config();
        config.put("imageApiKey", "secret-api-key");
        try {
            assertThatThrownBy(
                            () ->
                                    GenerationLog.task(
                                            123L,
                                            () ->
                                                    gateway.generate(
                                                            config,
                                                            "secret-prompt",
                                                            List.of(
                                                                    new GenerationGateway.Image(
                                                                            "person:1",
                                                                            origin
                                                                                    + "/reference?token=private-token")))))
                    .isInstanceOf(GenerationFailure.class);
            String logs =
                    capture.list.stream()
                            .map(ILoggingEvent::getFormattedMessage)
                            .reduce("", (a, b) -> a + b);
            assertThat(logs)
                    .contains(
                            "taskId=123",
                            "event=http_response",
                            "status=503",
                            "responseBytes=",
                            "elapsedMs=",
                            "protocol=openai-edits",
                            "model=fake",
                            "imageCount=1",
                            "code=EXTERNAL_RESULT_UNKNOWN",
                            "uncertain=true")
                    .doesNotContain(
                            "secret-api-key",
                            "secret-prompt",
                            "private-provider-error",
                            "private-token",
                            origin,
                            "b64_json");
            assertThat(posts.get()).isEqualTo(1);
            assertThat(capture.list).allSatisfy(e -> assertThat(e.getThrowableProxy()).isNull());
        } finally {
            logger.detachAppender(capture);
            capture.stop();
        }
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
    void trustedCatalogBytesAreSentInVisionAndMultipartAlongsidePerson() {
        var received = new java.util.concurrent.ConcurrentHashMap<String, String>();
        for (String path : List.of("/plan", "/image"))
            server.createContext(
                    path,
                    exchange -> {
                        received.put(
                                path,
                                new String(
                                        exchange.getRequestBody().readAllBytes(),
                                        StandardCharsets.ISO_8859_1));
                        String result =
                                path.equals("/plan")
                                        ? "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"{}\"}}]}"
                                        : "{\"data\":[{\"b64_json\":\""
                                                + Base64.getEncoder().encodeToString(PNG)
                                                + "\"}]}";
                        byte[] bytes = result.getBytes(StandardCharsets.UTF_8);
                        exchange.sendResponseHeaders(200, bytes.length);
                        exchange.getResponseBody().write(bytes);
                        exchange.close();
                    });
        var images =
                List.of(
                        new GenerationGateway.Image("person:1", origin + "/reference"),
                        new GenerationGateway.Image("hairstyle:crop:v1:front", PNG),
                        new GenerationGateway.Image("hairstyle:crop:v1:side", PNG));
        assertThat(gateway.plan(config(), "rules", "input", images)).isEqualTo("{}");
        assertThat(received.get("/plan"))
                .contains(
                        "hairstyle:crop:v1:front",
                        "hairstyle:crop:v1:side",
                        "data:image/png;base64,");
        assertThat(gateway.generate(config(), "hair", images)).isEqualTo(PNG);
        assertThat(received.get("/image"))
                .contains("hairstyle:crop:v1:front", "hairstyle:crop:v1:side");
        assertThat(
                        received.get("/image")
                                .split(java.util.regex.Pattern.quote("name=\"image[]\""), -1))
                .hasSize(4);
    }

    @Test
    void cumulativeTrustedImageBudgetRejectsBeforeRequest() {
        var config = config();
        config.put("maxInputBytes", PNG.length + 1);
        var images =
                List.of(
                        new GenerationGateway.Image("front", PNG),
                        new GenerationGateway.Image("side", PNG));
        assertThatThrownBy(() -> gateway.plan(config, "r", "i", images))
                .isInstanceOfSatisfying(
                        GenerationFailure.class,
                        e -> assertThat(e.getCode()).isEqualTo("INPUT_BUDGET_EXCEEDED"));
        assertThatThrownBy(() -> gateway.generate(config, "r", images))
                .isInstanceOfSatisfying(
                        GenerationFailure.class,
                        e -> assertThat(e.getCode()).isEqualTo("INPUT_BUDGET_EXCEEDED"));
        assertThat(posts).hasValue(0);
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

    @Test
    void siliconFlowUsesJsonAndDownloadsExactlyOneResult() {
        server.createContext(
                "/kolors",
                exchange -> {
                    posts.incrementAndGet();
                    String request =
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.UTF_8);
                    assertThat(exchange.getRequestHeaders().getFirst("Content-Type"))
                            .isEqualTo("application/json");
                    assertThat(exchange.getRequestHeaders().getFirst("Authorization"))
                            .isEqualTo("Bearer test-key");
                    assertThat(request)
                            .contains(
                                    "Kwai-Kolors/Kolors",
                                    "image_size",
                                    "num_inference_steps",
                                    origin + "/reference");
                    byte[] response =
                            ("{\"images\":[{\"url\":\"" + origin + "/reference\"}]}")
                                    .getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        var config = config();
        config.put("imageProtocol", "siliconflow-images");
        config.put("imageEndpoint", origin + "/kolors");
        config.put("imageModel", "Kwai-Kolors/Kolors");
        config.put(
                "imageParameters",
                Map.of(
                        "image_size",
                        "1024x1024",
                        "num_inference_steps",
                        "20",
                        "guidance_scale",
                        "7.5"));
        assertThat(gateway.generate(config, "draw", images())).isEqualTo(PNG);
        assertThat(posts.get()).isEqualTo(1);
    }

    @Test
    void unsupportedProtocolMissingCredentialAndMultipleReferencesNeverPost() {
        var config = config();
        config.put("imageProtocol", "siliconflow-images");
        var multiple =
                List.of(
                        images().getFirst(),
                        new GenerationGateway.Image("dress:2", origin + "/reference"));
        assertThatThrownBy(() -> gateway.generate(config, "draw", multiple))
                .hasMessage("INPUT_BUDGET_EXCEEDED");
        config.put("imageProtocol", "unknown");
        assertThatThrownBy(() -> gateway.generate(config, "draw", images()))
                .hasMessage("GENERATION_UNAVAILABLE");
        config.put("imageProtocol", "siliconflow-images");
        config.put("imageApiKey", "");
        assertThatThrownBy(() -> gateway.generate(config, "draw", images()))
                .hasMessage("GENERATION_UNAVAILABLE");
        config.put("planProtocol", "unknown");
        assertThatThrownBy(() -> gateway.plan(config, "system", "data", images()))
                .hasMessage("GENERATION_UNAVAILABLE");
        assertThat(posts.get()).isZero();
    }

    @Test
    void siliconFlowUnknownResultNeverRetries() {
        response("/image", 502, "bad gateway");
        var config = config();
        config.put("imageProtocol", "siliconflow-images");
        assertThatThrownBy(() -> gateway.generate(config, "draw", images()))
                .isInstanceOfSatisfying(
                        GenerationFailure.class, e -> assertThat(e.isUncertain()).isTrue());
        assertThat(posts.get()).isEqualTo(1);
    }
}
