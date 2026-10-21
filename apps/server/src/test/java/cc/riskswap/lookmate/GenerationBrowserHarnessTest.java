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
@EnabledIfEnvironmentVariable(named = "LOOKMATE_BROWSER_HARNESS", matches = "true")
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {
            "server.port=18084",
            "lookmate.jobs.enabled=true",
            "lookmate.generation.poll-ms=1000",
            "lookmate.recognition.enabled=false"
        })
@Import(GenerationBrowserHarnessTest.HarnessConfig.class)
class GenerationBrowserHarnessTest {
    @Autowired GenerationProperties p;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper json;
    @MockitoBean GenerationGateway gateway;
    @MockitoBean ObjectStorage storage;
    static final Map<String, byte[]> OBJECTS = new ConcurrentHashMap<>();

    @Test
    void serveUntilStopFile() throws Exception {
        final long user = 9100001, person = 9100011, top = 9100012, bottom = 9100013;
        p.setEnabled(true);
        p.setBudgetsVerified(true);
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
                .thenReturn("http://127.0.0.1:18084/api/test-generation-image");
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
                            var output = GenerationIntegrationTest.plan();
                            var plan = GenerationService.map(output.get("plan"));
                            String mode = (String) input.get("designType");
                            if (!mode.equals("HAIRSTYLE")) {
                                var items = new ArrayList<Map<String, Object>>();
                                for (var d : GenerationService.list(input.get("candidateItems"))) {
                                    String category = (String) d.get("categoryCode");
                                    if (!Set.of("TOP", "BOTTOM").contains(category)) continue;
                                    var img = GenerationService.list(d.get("images")).getFirst();
                                    items.add(
                                            Map.of(
                                                    "dressId",
                                                    d.get("dressId"),
                                                    "referenceImageIds",
                                                    List.of(img.get("imageId")),
                                                    "role",
                                                    category,
                                                    "matchReason",
                                                    "现有衣物适合日常组合",
                                                    "wearingMethod",
                                                    category.equals("TOP") ? "自然穿着上衣" : "搭配下装"));
                                }
                                plan.put("items", items);
                                plan.put("illustrativeShoes", Map.of("description", "浅色平底示意鞋"));
                            }
                            if (mode.equals("OUTFIT")) plan.put("hairstyle", null);
                            var checks = new ArrayList<Map<String, Object>>();
                            for (var c : GenerationService.list(input.get("effectiveConstraints")))
                                checks.add(
                                        Map.of(
                                                "constraintId",
                                                c.get("id"),
                                                "result",
                                                "SATISFIED",
                                                "explanation",
                                                "本地测试方案遵守该限制"));
                            output.put("constraintChecks", checks);
                            return json.writeValueAsString(output);
                        });
        if (jdbc.queryForObject("SELECT COUNT(*) FROM `user` WHERE id=?", Integer.class, user)
                == 0) {
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,display_name,created_at,updated_at) VALUES(?, 'generation_browser',?,'生成测试',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    passwords.encode("GenerationTest2026!"));
            for (long file : new long[] {person, top, bottom})
                jdbc.update(
                        "INSERT INTO file_asset(id,user_id,bucket,storage_key,mime_type,size_bytes,width,height,status,created_at,updated_at) VALUES(?,?,'test',?,'image/png',?,20,20,'READY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                        file,
                        user,
                        "browser/" + file,
                        image.length);
            jdbc.update(
                    "INSERT INTO user_photo(id,user_id,asset_id,photo_type,created_at,updated_at) VALUES(9100021,?,?,'FULL_BODY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    person);
            jdbc.update(
                    "UPDATE `user` SET default_full_body_id=9100021,default_portrait_id=9100021 WHERE id=?",
                    user);
            int n = 0;
            for (String category : List.of("TOP", "BOTTOM")) {
                long did = 9100031 + n, iid = 9100041 + n, fid = top + n;
                Long categoryId =
                        jdbc.queryForObject(
                                "SELECT id FROM dress_category WHERE code=?", Long.class, category);
                jdbc.update(
                        "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) VALUES(?,?,?, ?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                        did,
                        user,
                        n == 0 ? "测试白色上衣" : "测试蓝色长裤",
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
        jdbc.update("UPDATE file_asset SET thumbnail_key=storage_key WHERE user_id=?", user);
        java.nio.file.Path ready =
                java.nio.file.Path.of(
                        System.getProperty("java.io.tmpdir"), "lookmate-generation-browser.ready");
        java.nio.file.Path stop =
                java.nio.file.Path.of(
                        System.getProperty("java.io.tmpdir"), "lookmate-generation-browser.stop");
        java.nio.file.Files.deleteIfExists(stop);
        java.nio.file.Files.writeString(ready, "http://127.0.0.1:18084");
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
        @GetMapping(value = "/api/test-generation-image", produces = "image/png")
        byte[] image() throws Exception {
            return GenerationIntegrationTest.image();
        }
    }
}
