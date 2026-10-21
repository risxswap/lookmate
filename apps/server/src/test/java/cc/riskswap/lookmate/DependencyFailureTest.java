package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.data.redis.host=127.0.0.1", "spring.data.redis.port=1"})
class DependencyFailureTest {
    @LocalServerPort
    private int port;

    @Test
    void sessionSaveFailureReplacesPendingJsonWithServiceUnavailable() throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            var response =
                    client.send(
                            HttpRequest.newBuilder(
                                            URI.create(
                                                    "http://127.0.0.1:" + port + "/api/auth/csrf"))
                                    .GET()
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(response.body())
                    .contains("SERVICE_UNAVAILABLE", "requestId")
                    .doesNotContain("token", "UNAUTHENTICATED", "data");
            assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
            assertThat(response.headers().firstValue("Set-Cookie")).isEmpty();
        }
    }
}
