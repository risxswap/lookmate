package cc.riskswap.lookmate;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import com.sun.net.httpserver.HttpServer;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Explicit opt-in, isolated schema only; real HTTP/session/file/profile flow with local storage. */
@EnabledIfEnvironmentVariable(named = "LOOKMATE_PROFILE_BROWSER_HARNESS", matches = "true")
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {
            "server.port=18085",
            "lookmate.jobs.enabled=false",
            "lookmate.recognition.enabled=false",
            "lookmate.generation.enabled=false"
        })
class ProfileSlotsBrowserHarnessTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @MockitoBean ObjectStorage storage;

    @Test
    void serveUntilStopFile() throws Exception {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        if (database == null || !database.startsWith("lookmate_profile_slots_20261027_qa_")) {
            throw new IllegalStateException(
                    "This harness requires its dedicated disposable schema");
        }
        Path directory = Path.of("/private/tmp/lookmate-profile-slots-qa");
        Files.createDirectories(directory);
        byte[] image = image();
        Files.write(directory.resolve("test-photo.png"), image);
        var objects = new ConcurrentHashMap<String, byte[]>();
        var http = HttpServer.create(new InetSocketAddress("127.0.0.1", 18086), 0);
        http.createContext(
                "/",
                exchange -> {
                    exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                    exchange.getResponseHeaders()
                            .set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
                    exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "*");
                    if (exchange.getRequestMethod().equals("OPTIONS")) {
                        exchange.sendResponseHeaders(204, -1);
                    } else if (exchange.getRequestMethod().equals("POST")) {
                        String multipart =
                                new String(
                                        exchange.getRequestBody().readAllBytes(),
                                        StandardCharsets.ISO_8859_1);
                        var matcher =
                                Pattern.compile("name=\"key\"\\r\\n\\r\\n([^\\r]+)")
                                        .matcher(multipart);
                        if (matcher.find()) {
                            objects.put(matcher.group(1), image);
                            byte[] response =
                                    "{\"hash\":\"local-fixture\"}".getBytes(StandardCharsets.UTF_8);
                            exchange.getResponseHeaders().set("Content-Type", "application/json");
                            exchange.sendResponseHeaders(200, response.length);
                            exchange.getResponseBody().write(response);
                        } else {
                            exchange.sendResponseHeaders(400, -1);
                        }
                    } else {
                        exchange.getResponseHeaders().set("Content-Type", "image/png");
                        exchange.sendResponseHeaders(200, image.length);
                        exchange.getResponseBody().write(image);
                    }
                    exchange.close();
                });
        http.start();
        try {
            when(storage.available()).thenReturn(true);
            when(storage.bucket()).thenReturn("profile-browser-test");
            when(storage.uploadUrl()).thenReturn("http://127.0.0.1:18086/upload");
            when(storage.uploadToken(anyString(), anyLong(), anyLong()))
                    .thenReturn("local-fixture-token");
            when(storage.stat(anyString(), anyString()))
                    .thenAnswer(
                            invocation ->
                                    objects.containsKey(invocation.getArgument(1))
                                            ? new ObjectStorage.Metadata(image.length, "image/png")
                                            : null);
            when(storage.signedUrl(anyString(), anyString(), anyLong()))
                    .thenReturn("http://127.0.0.1:18086/image.png");
            when(storage.thumbnailUrl(anyString(), anyString(), anyLong()))
                    .thenReturn("http://127.0.0.1:18086/image.png");
            when(storage.read(anyString(), anyString(), anyInt()))
                    .thenAnswer(invocation -> objects.get(invocation.getArgument(1)));
            long user = 9200001;
            if (jdbc.queryForObject("SELECT COUNT(*) FROM `user` WHERE id=?", Integer.class, user)
                    == 0) {
                jdbc.update(
                        "INSERT INTO `user`(id,username,password_hash,display_name,created_at,updated_at) VALUES(?,'profile_browser',?,'资料测试',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                        user,
                        passwords.encode("ProfileTest2026!"));
            }
            Path ready = directory.resolve("ready");
            Path stop = directory.resolve("stop");
            Files.deleteIfExists(stop);
            Files.writeString(ready, "http://127.0.0.1:18085");
            long deadline = System.nanoTime() + Duration.ofMinutes(45).toNanos();
            try {
                while (System.nanoTime() < deadline && !Files.exists(stop)) Thread.sleep(1000);
            } finally {
                Files.deleteIfExists(ready);
            }
        } finally {
            http.stop(0);
        }
    }

    private static byte[] image() throws Exception {
        var image = new BufferedImage(480, 640, BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        graphics.setColor(new Color(223, 232, 217));
        graphics.fillRect(0, 0, 480, 640);
        graphics.setColor(new Color(88, 111, 91));
        graphics.fillOval(160, 70, 160, 160);
        graphics.fillRoundRect(100, 260, 280, 340, 110, 110);
        graphics.setColor(Color.WHITE);
        graphics.drawString("PROFILE TEST PHOTO", 160, 620);
        graphics.dispose();
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        return bytes.toByteArray();
    }
}
