package cc.riskswap.lookmate.storage;

import static org.assertj.core.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.net.http.*;
import org.junit.jupiter.api.Test;

class BoundedHttpTest {
    @Test
    void capsUpstreamBytes() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                e -> {
                    e.sendResponseHeaders(200, 1024);
                    try (var out = e.getResponseBody()) {
                        out.write(new byte[1024]);
                    }
                });
        server.start();
        try {
            var request =
                    HttpRequest.newBuilder(
                                    URI.create(
                                            "http://127.0.0.1:"
                                                    + server.getAddress().getPort()
                                                    + "/"))
                            .build();
            assertThatThrownBy(() -> BoundedHttp.send(HttpClient.newHttpClient(), request, 128, 5))
                    .isInstanceOf(java.util.concurrent.ExecutionException.class)
                    .hasRootCauseMessage("Response body limit exceeded");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void boundsTotalBodyTime() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        server.setExecutor(executor);
        server.createContext(
                "/",
                e -> {
                    e.sendResponseHeaders(200, 100);
                    try (var out = e.getResponseBody()) {
                        out.write(1);
                        out.flush();
                        try {
                            Thread.sleep(5000);
                        } catch (InterruptedException interrupted) {
                            Thread.currentThread().interrupt();
                        }
                    }
                });
        server.start();
        try {
            var request =
                    HttpRequest.newBuilder(
                                    URI.create(
                                            "http://127.0.0.1:"
                                                    + server.getAddress().getPort()
                                                    + "/"))
                            .build();
            assertThatThrownBy(() -> BoundedHttp.send(HttpClient.newHttpClient(), request, 128, 1))
                    .isInstanceOf(java.util.concurrent.TimeoutException.class);
        } finally {
            server.stop(0);
            executor.shutdownNow();
        }
    }
}
