package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.dao.mapper.GenerationMapper;
import cc.riskswap.lookmate.integration.ai.*;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import cc.riskswap.lookmate.service.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(properties = "lookmate.jobs.enabled=false")
class GenerationIntegrationTest {
    static final long USER = -2101, OTHER = -2102, FILE = 9007199254790000L;
    @Autowired GenerationService service;
    @Autowired GenerationExecutor executor;
    @Autowired GenerationMapper mapper;
    @Autowired WorkspaceService workspace;
    @Autowired GenerationProperties p;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @MockitoBean GenerationGateway gateway;
    @MockitoBean ObjectStorage storage;

    @BeforeEach
    void setup() throws Exception {
        clean();
        for (long u : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    u,
                    "generation_test_" + -u);
        for (int n = 0; n < 3; n++)
            jdbc.update(
                    "INSERT INTO file_asset(id,user_id,bucket,storage_key,mime_type,size_bytes,width,height,status,expires_at,created_at,updated_at) VALUES(?,?,'test',?,'image/jpeg',100,NULL,NULL,'TEMP',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    FILE + n,
                    n == 2 ? OTHER : USER,
                    "generation/" + n);
        p.setEnabled(true);
        p.setBudgetsVerified(true);
        p.setPreviewSecret("test-secret-is-at-least-thirty-two-characters");
        p.setPlanModel("test-plan");
        p.setPlanApiKey("test");
        p.setImageModel("test-image");
        p.setImageApiKey("test");
        p.setImageProtocol("openai-edits");
        p.setImageEndpoint("https://image.invalid/edits");
        p.setPlanningMaxImages(8);
        p.setImageMaxImages(8);
        p.setMaxInputBytes(1000000);
        p.setMaxTextChars(50000);
        p.setStagingDirectory(
                java.nio.file.Files.createTempDirectory("lookmate-generation-test-").toString());
        p.setMinFreeBytes(0);
        when(storage.available()).thenReturn(true);
        when(storage.bucket()).thenReturn("test");
        when(storage.signedUrl(anyString(), anyString(), anyLong()))
                .thenReturn("https://test.invalid/image.jpg");
        when(storage.read(anyString(), anyString(), anyInt()))
                .thenThrow(new java.io.IOException("missing"));
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenAnswer(inv -> json.writeValueAsString(plan()));
        when(gateway.generate(anyMap(), anyString(), anyList())).thenReturn(image());
    }

    @AfterEach
    void clean() {
        for (String t :
                List.of(
                        "design_task_asset",
                        "design_result_hairstyle",
                        "design_result_item",
                        "design_result",
                        "model_call",
                        "design_task",
                        "dress_image",
                        "dress",
                        "file_asset",
                        "user_preference"))
            jdbc.update("DELETE FROM " + t + " WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    static byte[] image() throws Exception {
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(
                new java.awt.image.BufferedImage(20, 20, java.awt.image.BufferedImage.TYPE_INT_RGB),
                "png",
                out);
        return out.toByteArray();
    }

    static Map<String, Object> plan() {
        var hair = new LinkedHashMap<String, Object>();
        for (String k :
                List.of(
                        "hairstyleName",
                        "lengthAdvice",
                        "bangsAdvice",
                        "partingAdvice",
                        "textureAdvice",
                        "hairColorAdvice",
                        "careAdvice")) hair.put(k, "自然发型");
        var plan = new LinkedHashMap<String, Object>();
        for (String k :
                List.of(
                        "title",
                        "summary",
                        "style",
                        "occasion",
                        "designReason",
                        "colorAdvice",
                        "wearingAdvice")) plan.put(k, "自然日常");
        plan.put("matchLevel", "EXACT");
        plan.put("hairstyle", hair);
        plan.put("items", List.of());
        plan.put("limitations", List.of());
        plan.put("interpretations", List.of());
        plan.put("illustrativeShoes", null);
        plan.put("novelty", null);
        plan.put("imageDirection", Map.of("wearingDetails", "保留原服饰", "composition", "保留本人特征"));
        var output = new LinkedHashMap<String, Object>();
        output.put("schemaVersion", 1);
        output.put("kind", "READY");
        output.put("plan", plan);
        output.put("constraintChecks", List.of());
        output.put("requestConstraints", List.of());
        output.put("noMatch", null);
        return output;
    }

    Map<String, Object> input() {
        return new LinkedHashMap<>(
                Map.of(
                        "designType",
                        "HAIRSTYLE",
                        "personFileId",
                        Long.toString(FILE),
                        "profileVersion",
                        "0"));
    }

    Map<String, Object> submit(String key) {
        var input = input();
        var preview = service.preview(USER, input);
        return service.submit(
                USER, key, Map.of("input", input, "previewToken", preview.get("previewToken")));
    }

    long task(Map<String, Object> result) {
        return Long.parseLong((String) result.get("taskId"));
    }

    void run(long id) {
        executor.execute(mapper.get(USER, id));
    }

    void error(Runnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    @Test
    void completeAndReplayAndPrivateProjection() throws Exception {
        String key = UUID.randomUUID().toString();
        long id = task(submit(key));
        run(id);
        assertThat(mapper.get(USER, id).getStatus()).isEqualTo("SUCCEEDED");
        var output =
                jdbc.queryForMap(
                        "SELECT mime_type,thumbnail_key,storage_key FROM file_asset WHERE id=?",
                        workspace.detail(USER, Long.toString(id)).getOutputFileId());
        assertThat(output.get("mime_type")).isEqualTo("image/png");
        assertThat(output.get("thumbnail_key")).isNull();
        verify(storage, times(1))
                .put(
                        eq("test"),
                        eq((String) output.get("storage_key")),
                        eq(image()),
                        eq("image/png"));

        assertThat(workspace.detail(USER, Long.toString(id)).getOutputFileId()).isNotBlank();
        assertThat(workspace.detail(USER, Long.toString(id)).getInputSummary().toString())
                .doesNotContain("test-secret", "planApiKey", "birthDate");
        p.setEnabled(false);
        assertThat(
                        service.submit(
                                        USER,
                                        key,
                                        Map.of("input", input(), "previewToken", "expired"))
                                .get("taskId"))
                .isEqualTo(Long.toString(id));
        error(() -> service.byKey(OTHER, key), "DESIGN_REQUEST_NOT_FOUND");
        verify(gateway, times(1)).plan(anyMap(), anyString(), anyString(), anyList());
        verify(gateway, times(1)).generate(anyMap(), anyString(), anyList());
    }

    @Test
    void concurrentSameKeyCreatesOnlyOne() throws Exception {
        String key = UUID.randomUUID().toString();
        var in = input();
        String token = (String) service.preview(USER, in).get("previewToken");
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a =
                    pool.submit(
                            () ->
                                    service.submit(
                                            USER, key, Map.of("input", in, "previewToken", token)));
            var b =
                    pool.submit(
                            () ->
                                    service.submit(
                                            USER, key, Map.of("input", in, "previewToken", token)));
            assertThat(a.get()).isEqualTo(b.get());
        }
        assertThat(mapper.userPending(USER)).isEqualTo(1);
    }

    @Test
    void previewChangesOwnership() {
        var in = input();
        String token = (String) service.preview(USER, in).get("previewToken");
        jdbc.update("UPDATE `user` SET version=1 WHERE id=?", USER);
        error(
                () ->
                        service.submit(
                                USER,
                                UUID.randomUUID().toString(),
                                Map.of("input", in, "previewToken", token)),
                "PROFILE_CHANGED");
        in.put("profileVersion", "1");
        in.put("personFileId", Long.toString(FILE + 2));
        error(() -> service.preview(USER, in), "RESOURCE_NOT_FOUND");
    }

    @Test
    void unknownDoesNotRetryAndReleasesSlot() throws Exception {
        when(gateway.generate(anyMap(), anyString(), anyList()))
                .thenThrow(new GenerationFailure("EXTERNAL_RESULT_UNKNOWN", true));
        long id = task(submit(UUID.randomUUID().toString()));
        run(id);
        assertThat(mapper.get(USER, id).getStatus()).isEqualTo("UNKNOWN");
        error(
                () ->
                        service.retry(
                                USER,
                                Long.toString(id),
                                UUID.randomUUID().toString(),
                                Map.of("mode", "FULL")),
                "ACTION_NOT_ALLOWED");
        assertThat(mapper.userPending(USER)).isZero();
        executor.recover();
        verify(gateway, times(1)).generate(anyMap(), anyString(), anyList());
    }

    @Test
    void imageRetryPreservesPlan() throws Exception {
        when(gateway.generate(anyMap(), anyString(), anyList()))
                .thenThrow(new GenerationFailure("IMAGE_PROVIDER_FAILED", false))
                .thenReturn(image());
        long first = task(submit(UUID.randomUUID().toString()));
        run(first);
        p.setImageMaxImages(4);
        p.setPlanningMaxImages(4);
        long second =
                task(
                        service.retry(
                                USER,
                                Long.toString(first),
                                UUID.randomUUID().toString(),
                                Map.of("mode", "IMAGE_ONLY")));
        run(second);
        assertThat(mapper.get(USER, second).getStatus()).isEqualTo("SUCCEEDED");
        verify(gateway, times(1)).plan(anyMap(), anyString(), anyString(), anyList());
        verify(gateway, times(2)).generate(anyMap(), anyString(), anyList());
    }

    @Test
    void saveFailureRecoversWithoutCredentials() throws Exception {
        doThrow(new java.io.IOException("temporary outage"))
                .doNothing()
                .when(storage)
                .put(anyString(), anyString(), any(), anyString());
        long id = task(submit(UUID.randomUUID().toString()));
        run(id);
        assertThat(mapper.get(USER, id).getStatus()).isEqualTo("SAVING");
        p.setPlanApiKey("");
        p.setImageApiKey("");
        run(id);
        assertThat(mapper.get(USER, id).getStatus()).isEqualTo("SUCCEEDED");
        verify(gateway, times(1)).generate(anyMap(), anyString(), anyList());
    }

    @Test
    void noMatchStopsImage() throws Exception {
        var no = new LinkedHashMap<String, Object>();
        no.put("schemaVersion", 1);
        no.put("kind", "NO_MATCH");
        no.put("plan", null);
        no.put("constraintChecks", List.of());
        no.put("requestConstraints", List.of());
        no.put(
                "noMatch",
                Map.of(
                        "reasonCode",
                        "PHOTO_INSUFFICIENT",
                        "message",
                        "请提供清晰照片",
                        "relatedConstraintIds",
                        List.of()));
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenReturn(json.writeValueAsString(no));
        long id = task(submit(UUID.randomUUID().toString()));
        run(id);
        assertThat(mapper.get(USER, id).getErrorCode()).isEqualTo("PERSON_PHOTO_INSUFFICIENT");
        verify(gateway, never()).generate(anyMap(), anyString(), anyList());
    }

    @Test
    void previewBlocksOnlyConfirmedManualConflictAndChecksBudget() {
        jdbc.update(
                "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) SELECT 920001,?,'上衣',id,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM dress_category WHERE code='TOP'",
                USER);
        jdbc.update(
                "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) SELECT 920002,?,'下装',id,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM dress_category WHERE code='BOTTOM'",
                USER);
        for (int n = 0; n < 2; n++)
            jdbc.update(
                    "INSERT INTO dress_image(id,user_id,dress_id,asset_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    920011 + n,
                    USER,
                    920001 + n,
                    FILE + n);
        var in = input();
        in.put("designType", "OUTFIT");
        in.put("requiredDressIds", List.of("920001"));
        jdbc.update(
                "INSERT INTO user_preference(user_id,restrictions,created_at,updated_at) VALUES(?, '[\"NO_TIGHT\"]',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER);
        jdbc.update("UPDATE dress_image SET fit='SLIM' WHERE id=920011");
        assertThat(service.preview(USER, in).get("canSubmit")).isEqualTo(true);
        jdbc.update("UPDATE dress_image SET manual_features='{\"fit\":\"SLIM\"}' WHERE id=920011");
        var blocked = service.preview(USER, in);
        assertThat(blocked.get("canSubmit")).isEqualTo(false);
        assertThat(blocked.get("previewToken")).isNull();
        assertThat(GenerationService.list(blocked.get("conflicts"))).hasSize(1);
        in.put("constraintOverrides", List.of("NO_TIGHT"));
        assertThat(service.preview(USER, in).get("canSubmit")).isEqualTo(true);
        p.setImageMaxImages(1);
        assertThatThrownBy(() -> service.preview(USER, in)).isInstanceOf(ApiException.class);
    }

    @Test
    void outfitSnapshotsSurviveSourceDeletionAndShowShoeNotice() throws Exception {
        jdbc.update(
                "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) SELECT 920001,?,'上衣',id,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM dress_category WHERE code='TOP'",
                USER);
        jdbc.update(
                "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) SELECT 920002,?,'下装',id,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM dress_category WHERE code='BOTTOM'",
                USER);
        for (int n = 0; n < 2; n++)
            jdbc.update(
                    "INSERT INTO dress_image(id,user_id,dress_id,asset_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    920011 + n,
                    USER,
                    920001 + n,
                    FILE + n);
        var in = input();
        in.put("designType", "OUTFIT");
        in.put("requiredDressIds", List.of("920001"));
        var ready = plan();
        var plan = GenerationService.map(ready.get("plan"));
        plan.put("hairstyle", null);
        plan.put(
                "items",
                List.of(
                        Map.of(
                                "dressId",
                                "920001",
                                "referenceImageIds",
                                List.of("920011"),
                                "role",
                                "TOP",
                                "matchReason",
                                "上衣",
                                "wearingMethod",
                                "自然穿着"),
                        Map.of(
                                "dressId",
                                "920002",
                                "referenceImageIds",
                                List.of("920012"),
                                "role",
                                "BOTTOM",
                                "matchReason",
                                "下装",
                                "wearingMethod",
                                "自然穿着")));
        plan.put("illustrativeShoes", Map.of("description", "浅色平底鞋"));
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenReturn(json.writeValueAsString(ready));
        var preview = service.preview(USER, in);
        long id =
                task(
                        service.submit(
                                USER,
                                UUID.randomUUID().toString(),
                                Map.of("input", in, "previewToken", preview.get("previewToken"))));
        jdbc.update(
                "UPDATE file_asset SET cleanup_after=UTC_TIMESTAMP(3) WHERE user_id=? AND id<>?",
                USER,
                FILE);
        jdbc.update("DELETE FROM dress_image WHERE user_id=?", USER);
        jdbc.update("DELETE FROM dress WHERE user_id=?", USER);
        run(id);
        assertThat(mapper.get(USER, id).getStatus()).isEqualTo("SUCCEEDED");
        var detail = workspace.detail(USER, Long.toString(id));
        assertThat(detail.getResult().getItems()).hasSize(2);
        assertThat(detail.getResult().getItems().getFirst().getDressName()).isEqualTo("上衣");
        assertThat(detail.getResult().getNotices())
                .anySatisfy(n -> assertThat(n.get("code")).isEqualTo("ILLUSTRATIVE_SHOES"));
    }

    @Test
    void lostStagingIsTerminalAndExpiredSentIsUnknown() {
        long id = task(submit(UUID.randomUUID().toString()));
        jdbc.update("UPDATE design_task SET status='SAVING',attempt_token=NULL WHERE id=?", id);
        run(id);
        assertThat(mapper.get(USER, id).getErrorCode()).isEqualTo("RESULT_SAVE_FAILED");
        long second = task(submit(UUID.randomUUID().toString()));
        jdbc.update(
                "UPDATE design_task SET status='GENERATING',attempt_token='old',current_call_id=9999999,lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
                second);
        executor.recover();
        assertThat(mapper.get(USER, second).getStatus()).isEqualTo("UNKNOWN");
    }
}
