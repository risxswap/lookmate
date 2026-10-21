package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApplicationSmokeTest {

    @LocalServerPort
    private int port;

    @Autowired
    private StringRedisTemplate redis;

    @Value("${spring.session.data.redis.namespace}")
    private String namespace;

    @Test
    void csrfSessionIsStoredInConfiguredRedisNamespace() throws Exception {
        var response = get("/api/auth/csrf");
        assertThat(response.statusCode()).isEqualTo(200);
        String cookie = response.headers().firstValue("Set-Cookie").orElseThrow();
        assertThat(cookie).startsWith("LOOKMATE_SESSION=").contains("HttpOnly", "SameSite=Lax");
        String encodedId = cookie.substring(cookie.indexOf('=') + 1, cookie.indexOf(';'));
        String sessionId =
                new String(Base64.getDecoder().decode(encodedId), StandardCharsets.UTF_8);
        assertThat(redis.hasKey(namespace + ":sessions:" + sessionId)).isTrue();
    }

    @Test
    void healthIsPublicWithoutExposingDetails() throws Exception {
        var response = get("/actuator/health");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"status\":\"UP\"").doesNotContain("components");
        assertThat(get("/actuator/health/liveness").statusCode()).isEqualTo(200);
    }

    @Test
    void otherEndpointsAreNotPublic() throws Exception {
        assertThat(get("/api/profile").statusCode()).isEqualTo(401);
        assertThat(get("/actuator/env").statusCode()).isEqualTo(401);
        assertThat(get("/login").statusCode()).isEqualTo(401);
    }

    private HttpResponse<String> get(String path) throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            return client.send(
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
        }
    }
}
