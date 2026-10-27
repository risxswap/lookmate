package cc.riskswap.lookmate;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.integration.ai.GenerationGateway;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import cc.riskswap.lookmate.service.GenerationService;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** Explicit opt-in local harness. Real controllers, MySQL transactions, Redis sessions and scheduler. */
@EnabledIfEnvironmentVariable(named = "LOOKMATE_OUTFIT_BROWSER_HARNESS", matches = "true")
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {
            "server.port=18086",
            "lookmate.generation.poll-ms=1000",
            "lookmate.recognition.api-key="
        })
@Import(OutfitBrowserHarnessTest.HarnessConfig.class)
class OutfitBrowserHarnessTest {
    @Autowired GenerationProperties p;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper json;
    @MockitoBean GenerationGateway gateway;
    @MockitoBean ObjectStorage storage;
    static final Map<String, byte[]> OBJECTS = new ConcurrentHashMap<>();

    @Test
    void serveUntilStopFile() throws Exception {
        final long user = 9300001, person = 9300011, top = 9300012, bottom = 9300013;
        p.setPreviewSecret("browser-test-secret-is-at-least-thirty-two-characters");
        p.setPlanModel("browser-plan");
        p.setPlanApiKey("local");
        p.setImageModel("browser-image");
        p.setImageApiKey("local");
        p.setImageEndpoint("https://unused.invalid/edits");
        p.setPlanningMaxImages(12);
        p.setImageMaxImages(12);
        p.setMaxInputBytes(10000000);
        p.setMaxTextChars(100000);
        p.setStagingDirectory(
                java.nio.file.Files.createTempDirectory("lookmate-browser-generation-").toString());
        p.setMinFreeBytes(0);
        byte[] image = GenerationIntegrationTest.image();
        when(storage.available()).thenReturn(true);
        when(storage.bucket()).thenReturn("test");
        when(storage.signedUrl(anyString(), anyString(), anyLong()))
                .thenReturn("http://127.0.0.1:18086/api/test-outfit-image");
        when(storage.read(anyString(), anyString(), anyInt()))
                .thenAnswer(i -> OBJECTS.getOrDefault(i.getArgument(1), image));
        doAnswer(
                        i -> {
                            OBJECTS.put(i.getArgument(1), i.getArgument(2));
                            return null;
                        })
                .when(storage)
                .put(anyString(), anyString(), any(), anyString());
        when(gateway.generate(anyMap(), anyString(), anyList()))
                .thenAnswer(
                        i -> {
                            Thread.sleep(1000);
                            return image;
                        });
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenAnswer(
                        i -> {
                            Thread.sleep(1000);
                            var input = json.readValue((String) i.getArgument(2), Map.class);
                            String note =
                                    String.valueOf(
                                            GenerationService.map(input.get("normalizedRequest"))
                                                    .get("requirements"));
                            if (note.contains("HARNESS_UNKNOWN"))
                                throw new cc.riskswap.lookmate.integration.ai.GenerationFailure(
                                        "EXTERNAL_RESULT_UNKNOWN", true);
                            if (note.contains("HARNESS_FAIL"))
                                throw new cc.riskswap.lookmate.integration.ai.GenerationFailure(
                                        "PLAN_PROVIDER_FAILED", false);
                            var output = OutfitAiIntegrationTest.fixedPlan(input);
                            if ("IMAGE".equals(input.get("jobKind"))
                                    && GenerationService.list(input.get("candidateItems")).stream()
                                            .noneMatch(d -> "SHOE".equals(d.get("categoryCode"))))
                                GenerationService.map(output.get("plan"))
                                        .put("illustrativeShoes", Map.of("description", "浅色平底示意鞋"));
                            return json.writeValueAsString(output);
                        });
        if (jdbc.queryForObject("SELECT COUNT(*) FROM `user` WHERE id=?", Integer.class, user)
                == 0) {
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,display_name,created_at,updated_at) VALUES(?, 'outfit_browser',?,'生成测试',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    passwords.encode("OutfitTest2026!"));
            for (long file : new long[] {person, top, bottom, bottom + 1})
                jdbc.update(
                        "INSERT INTO file_asset(id,user_id,bucket,storage_key,mime_type,size_bytes,width,height,status,created_at,updated_at) VALUES(?,?,'test',?,'image/png',?,20,20,'READY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                        file,
                        user,
                        "browser/" + file,
                        image.length);
            jdbc.update(
                    "INSERT INTO user_photo(id,user_id,asset_id,photo_type,created_at,updated_at) VALUES(9300021,?,?,'FULL_BODY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    person);
            jdbc.update(
                    "UPDATE `user` SET default_full_body_id=9300021,default_portrait_id=9300021 WHERE id=?",
                    user);
            int n = 0;
            for (String category : List.of("TOP", "BOTTOM", "SHOE")) {
                long did = 9300031 + n, iid = 9300041 + n, fid = top + n;
                Long categoryId =
                        jdbc.queryForObject(
                                "SELECT id FROM dress_category WHERE code=?", Long.class, category);
                jdbc.update(
                        "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) VALUES(?,?,?, ?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                        did,
                        user,
                        n == 0 ? "白色通勤衬衫" : n == 1 ? "灰色直筒长裤" : "白色运动鞋",
                        categoryId);
                jdbc.update(
                        "INSERT INTO dress_image(id,user_id,dress_id,asset_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                        iid,
                        user,
                        did,
                        fid);
                n++;
            }
        }
        if (jdbc.queryForObject("SELECT COUNT(*) FROM `user` WHERE id=9300002", Integer.class) == 0)
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,display_name,created_at,updated_at) VALUES(9300002,'outfit_other',?,'另一账号',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    passwords.encode("OutfitTest2026!"));
        jdbc.update("UPDATE file_asset SET thumbnail_key=storage_key WHERE user_id=?", user);
        java.nio.file.Path ready =
                java.nio.file.Path.of(
                        System.getProperty("java.io.tmpdir"), "lookmate-outfit-browser.ready");
        java.nio.file.Path stop =
                java.nio.file.Path.of(
                        System.getProperty("java.io.tmpdir"), "lookmate-outfit-browser.stop");
        java.nio.file.Files.deleteIfExists(stop);
        java.nio.file.Files.writeString(ready, "http://127.0.0.1:18086");
        long deadline = System.nanoTime() + java.time.Duration.ofMinutes(30).toNanos();
        while (System.nanoTime() < deadline && !java.nio.file.Files.exists(stop))
            Thread.sleep(1000);
        java.nio.file.Files.deleteIfExists(ready);
    }

    @TestConfiguration
    static class HarnessConfig {
        @Bean
        ImageController imageController() {
            return new ImageController();
        }
    }

    @RestController
    static class ImageController {
        @GetMapping(value = "/api/test-outfit-image", produces = "image/png")
        byte[] image() throws Exception {
            return GenerationIntegrationTest.image();
        }
    }
}
