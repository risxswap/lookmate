package cc.riskswap.lookmate.integration.wechat;

import static org.assertj.core.api.Assertions.assertThat;

import cc.riskswap.lookmate.config.WechatProperties;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class WechatClientTest {
    @TempDir Path tempDir;

    @ParameterizedTest
    @CsvSource({
        "dev, develop, false, jpeg",
        "dev, trial, true, jpeg",
        "dev, release, true, jpeg",
        "default, develop, true, jpeg",
        "dev, develop, false, png"
    })
    void requestsTransparentCodeWithConfiguredPageCheckAndReturnsImageUnchanged(
            String profile, String envVersion, boolean checkPath, String imageFormat)
            throws IOException {
        Path devConfig = Files.createFile(tempDir.resolve("dev.properties"));
        String contentType = "image/" + imageFormat;
        byte[] imageBytes = codeImage(imageFormat);
        var mapper = JsonMapper.builder().build();
        var codeRequest = new AtomicReference<JsonNode>();
        var upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext(
                "/cgi-bin/token",
                exchange ->
                        reply(
                                exchange,
                                "application/json",
                                "{\"access_token\":\"test\",\"expires_in\":7200}"
                                        .getBytes(StandardCharsets.UTF_8)));
        upstream.createContext(
                "/wxa/getwxacodeunlimit",
                exchange -> {
                    codeRequest.set(mapper.readTree(exchange.getRequestBody().readAllBytes()));
                    reply(exchange, contentType, imageBytes);
                });
        upstream.start();
        try {
            new ApplicationContextRunner()
                    .withPropertyValues(
                            "spring.profiles.active=" + profile,
                            "LOOKMATE_DEV_CONFIG=" + devConfig,
                            "LOOKMATE_WECHAT_ENV_VERSION=" + envVersion)
                    .withInitializer(new ConfigDataApplicationContextInitializer())
                    .run(
                            context -> {
                                var properties =
                                        Binder.get(context.getEnvironment())
                                                .bindOrCreate(
                                                        "lookmate.wechat", WechatProperties.class);
                                properties.setAppId("test-app");
                                properties.setAppSecret("test-secret");
                                properties.setApiBaseUrl(
                                        "http://127.0.0.1:" + upstream.getAddress().getPort());
                                var client = new WechatClient(properties, mapper);

                                assertThat(client.qr("test-scene"))
                                        .isEqualTo(
                                                "data:"
                                                        + contentType
                                                        + ";base64,"
                                                        + Base64.getEncoder()
                                                                .encodeToString(imageBytes));
                                JsonNode request = codeRequest.get();
                                JsonNode transparent = request.path("is_hyaline");
                                assertThat(transparent.isBoolean())
                                        .as("is_hyaline is boolean")
                                        .isTrue();
                                assertThat(transparent.asBoolean())
                                        .as("is_hyaline is true")
                                        .isTrue();
                                assertThat(request.path("check_path").isBoolean()).isTrue();
                                assertThat(request.path("check_path").asBoolean())
                                        .isEqualTo(checkPath);
                                assertThat(request.path("scene").asText()).isEqualTo("test-scene");
                                assertThat(request.path("page").asText())
                                        .isEqualTo("pages/scan/index");
                                assertThat(request.path("env_version").asText())
                                        .isEqualTo(envVersion);
                            });
        } finally {
            upstream.stop(0);
        }
    }

    private static byte[] codeImage(String format) throws IOException {
        int imageType =
                "png".equals(format) ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        var image = new BufferedImage(1, 1, imageType);
        var output = new ByteArrayOutputStream();
        assertThat(ImageIO.write(image, format, output)).isTrue();
        return output.toByteArray();
    }

    private static void reply(HttpExchange exchange, String contentType, byte[] bytes)
            throws IOException {
        try (exchange) {
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
    }
}
