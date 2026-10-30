package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.dao.mapper.FileMapper;
import cc.riskswap.lookmate.dao.mapper.GenerationMapper;
import cc.riskswap.lookmate.integration.ai.*;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import cc.riskswap.lookmate.service.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest
@org.springframework.test.context.bean.override.mockito.MockitoBean(
        types = {
            cc.riskswap.lookmate.scheduler.AssetScheduler.class,
            cc.riskswap.lookmate.scheduler.RecognitionScheduler.class,
            cc.riskswap.lookmate.scheduler.GenerationScheduler.class
        })
class OutfitAiIntegrationTest {
    static final long USER = -2401,
            OTHER = -2402,
            PERSON = 9240011,
            TOP = 9240031,
            BOTTOM = 9240032;
    @Autowired OutfitAiService ai;
    @Autowired OutfitService outfits;
    @Autowired GenerationService generation;
    @Autowired GenerationExecutor executor;
    @Autowired GenerationMapper tasks;
    @Autowired FileMapper files;
    @Autowired WorkspaceService workspace;
    @Autowired RecordsService records;
    @Autowired GenerationProperties p;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @MockitoBean GenerationGateway gateway;
    @MockitoBean ObjectStorage storage;

    @BeforeEach
    void setup() throws Exception {
        clean();
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    "outfit_ai_" + -user);
        for (int n = 0; n < 3; n++)
            jdbc.update(
                    "INSERT INTO file_asset(id,user_id,bucket,storage_key,mime_type,size_bytes,width,height,status,created_at,updated_at) VALUES(?,?,'test',?,'image/png',100,20,20,'READY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    PERSON + n,
                    USER,
                    "outfit-ai/" + n);
        for (int n = 0; n < 2; n++) {
            Long category =
                    jdbc.queryForObject(
                            "SELECT id FROM dress_category WHERE code=?",
                            Long.class,
                            n == 0 ? "TOP" : "BOTTOM");
            jdbc.update(
                    "INSERT INTO dress(id,user_id,name,category_id,image_revision,created_at,updated_at) VALUES(?,?,?, ?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    TOP + n,
                    USER,
                    n == 0 ? "白衬衫" : "灰裤子",
                    category);
            jdbc.update(
                    "INSERT INTO dress_image(id,user_id,dress_id,asset_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    9240041 + n,
                    USER,
                    TOP + n,
                    PERSON + n + 1);
        }
        p.setPreviewSecret("outfit-test-secret-at-least-thirty-two-characters");
        p.setPlanEndpoint("https://plan.invalid/chat");
        p.setPlanModel("outfit-plan");
        p.setPlanApiKey("test");
        p.setImageProtocol("openai-edits");
        p.setImageEndpoint("https://image.invalid/edits");
        p.setImageModel("outfit-image");
        p.setImageApiKey("test");
        p.setPlanningMaxImages(8);
        p.setImageMaxImages(8);
        p.setMaxInputBytes(1000000);
        p.setMaxTextChars(50000);
        p.setStagingDirectory(java.nio.file.Files.createTempDirectory("outfit-ai-it-").toString());
        p.setMinFreeBytes(0);
        when(storage.available()).thenReturn(true);
        when(storage.bucket()).thenReturn("test");
        when(storage.signedUrl(anyString(), anyString(), anyLong()))
                .thenReturn("https://test.invalid/image.png");
        when(storage.read(anyString(), anyString(), anyInt()))
                .thenThrow(new java.io.IOException("missing"));
        doAnswer(
                        i ->
                                json.writeValueAsString(
                                        fixedPlan(
                                                json.readValue(
                                                        (String) i.getArgument(2), Map.class))))
                .when(gateway)
                .plan(anyMap(), anyString(), anyString(), anyList());
        doReturn(GenerationIntegrationTest.image())
                .when(gateway)
                .generate(anyMap(), anyString(), anyList());
    }

    @AfterEach
    void clean() {
        for (String table :
                List.of(
                        "outfit_ai_job",
                        "outfit_group_member",
                        "outfit_item_asset",
                        "outfit_item",
                        "outfit",
                        "outfit_group",
                        "design_favorite",
                        "design_task_asset",
                        "design_result_hairstyle",
                        "design_result_item",
                        "design_result",
                        "model_call",
                        "design_task",
                        "dress_image",
                        "dress",
                        "file_asset"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    static Map<String, Object> fixedPlan(Map<String, Object> snapshot) {
        var output = GenerationIntegrationTest.plan();
        var plan = GenerationService.map(output.get("plan"));
        plan.put("hairstyle", null);
        var items = new ArrayList<Map<String, Object>>();
        for (var item : GenerationService.list(snapshot.get("candidateItems"))) {
            String category = (String) item.get("categoryCode");
            String role =
                    switch (category) {
                        case "DRESS" -> "ONE_PIECE";
                        case "SHOE" -> "SHOES";
                        case "COAT" -> "OUTERWEAR";
                        default -> category;
                    };
            items.add(
                    Map.of(
                            "dressId",
                            item.get("dressId"),
                            "referenceImageIds",
                            List.of(
                                    GenerationService.list(item.get("images"))
                                            .getFirst()
                                            .get("imageId")),
                            "role",
                            role,
                            "matchReason",
                            "保留用户选定单品",
                            "wearingMethod",
                            "自然穿着"));
        }
        plan.put("items", items);
        return output;
    }

    String outfit(boolean complete) {
        return outfits.create(
                        USER,
                        Map.of(
                                "name",
                                "通勤",
                                "dressIds",
                                complete ? List.of("" + TOP, "" + BOTTOM) : List.of("" + TOP)))
                .getId();
    }

    Map<String, Object> submit(String outfit, String kind) {
        var body = new LinkedHashMap<String, Object>(Map.of("kind", kind, "revision", "0"));
        if (kind.equals("IMAGE")) body.put("personFileId", "" + PERSON);
        return ai.submit(USER, outfit, UUID.randomUUID().toString(), body);
    }

    void run(Map<String, Object> job) {
        executor.execute(tasks.get(USER, Long.valueOf((String) job.get("taskId"))));
    }

    void error(Runnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    @Test
    void currentResultsIgnoreHistoryPageAndOldRevision() {
        String outfit = outfit(true);
        assertThat(ai.current(USER, outfit).values()).containsOnlyNulls();
        error(() -> ai.current(OTHER, outfit), "OUTFIT_NOT_FOUND");
        var image = submit(outfit, "IMAGE");
        run(image);
        var evaluation = submit(outfit, "EVALUATION");
        run(evaluation);
        var pending = submit(outfit, "EVALUATION");
        jdbc.update(
                "UPDATE outfit_ai_job SET created_at='2026-01-01 00:00:00' WHERE outfit_id=?",
                outfit);
        var current = ai.current(USER, outfit);
        assertThat((Map<?, ?>) current.get("image"))
                .usingRecursiveComparison()
                .isEqualTo(ai.detail(USER, (String) image.get("taskId")));
        assertThat((Map<?, ?>) current.get("evaluation"))
                .usingRecursiveComparison()
                .isEqualTo(ai.detail(USER, (String) evaluation.get("taskId")));
        assertThat((Map<?, ?>) current.get("latest"))
                .usingRecursiveComparison()
                .isEqualTo(ai.detail(USER, (String) pending.get("taskId")));
        jdbc.update(
                "UPDATE design_task SET hidden_at=UTC_TIMESTAMP(3) WHERE id=?",
                pending.get("taskId"));
        assertThat((Map<?, ?>) ai.current(USER, outfit).get("latest"))
                .usingRecursiveComparison()
                .isEqualTo(ai.detail(USER, (String) evaluation.get("taskId")));
        jdbc.update("UPDATE outfit SET revision=revision+1 WHERE id=?", outfit);
        assertThat(ai.current(USER, outfit).values()).containsOnlyNulls();
    }

    @Test
    void evaluationWithoutPhotoOrImageCredentialsAcceptsIncompleteAndNeverGeneratesOrFavorites() {
        p.setPreviewSecret("");
        p.setImageApiKey("");
        p.setImageModel("");
        p.setImageEndpoint("");
        p.setImageMaxImages(0);
        String outfit = outfit(false);
        var job = submit(outfit, "EVALUATION");
        run(job);
        String task = (String) job.get("taskId");
        var result = ai.detail(USER, task);
        assertThat(result.get("status")).isEqualTo("SUCCEEDED");
        assertThat(result.get("outputFileId")).isNull();
        assertThat((List<String>) result.get("actions")).containsExactly("VIEW");
        verify(gateway, never()).generate(anyMap(), anyString(), anyList());
        verify(gateway)
                .plan(
                        argThat(c -> !c.containsKey("imageApiKey")),
                        contains("NEVER assess actual fit"),
                        contains("\"personFileId\":null"),
                        argThat(i -> i.size() == 1));
        var detail = workspace.detail(USER, task);
        assertThat(GenerationService.list(detail.getInputSummary().get("requiredDresses")))
                .singleElement()
                .satisfies(
                        item ->
                                assertThat(item)
                                        .containsEntry("dressId", "" + TOP)
                                        .containsEntry("dressName", "白衬衫")
                                        .containsKey("categoryName")
                                        .containsEntry("imageFileIds", List.of("" + (PERSON + 1))));
        assertThat(detail.getInputSummary().get("personPhoto")).isNull();
        var persisted = generation.read(tasks.get(USER, Long.valueOf(task)).getInputSnapshot());
        assertThat(persisted)
                .containsEntry("schemaVersion", 3)
                .containsEntry("fixedOutfit", true)
                .containsEntry("outfitInspirationReference", null);
        assertThat(detail.getActions()).doesNotContain("FAVORITE", "NEW_FROM_INPUT", "RETRY_IMAGE");
        assertThat(detail.getResult().getNotices())
                .anyMatch(n -> "LIMITED_VISUAL_EVIDENCE".equals(n.get("code")));
        error(() -> records.favorite(USER, detail.getResult().getId()), "DESIGN_NOT_SUCCEEDED");
        error(() -> outfits.fromDesign(USER, task, Map.of()), "DESIGN_NOT_FOUND");
        assertThat(workspace.workspace(USER).getRecentTasks().getFirst().getJobKind())
                .isEqualTo("EVALUATION");
    }

    @Test
    void photoAndCompleteOutfitRequiredForImageAndForeignResourcesRejected() {
        String outfit = outfit(false);
        error(
                () ->
                        ai.submit(
                                USER,
                                outfit,
                                UUID.randomUUID().toString(),
                                Map.of("kind", "IMAGE", "revision", "0")),
                "PERSON_PHOTO_REQUIRED");
        error(() -> submit(outfit, "IMAGE"), "OUTFIT_NOT_FEASIBLE");
        error(
                () ->
                        ai.submit(
                                OTHER,
                                outfit,
                                UUID.randomUUID().toString(),
                                Map.of("kind", "EVALUATION", "revision", "0")),
                "OUTFIT_NOT_FOUND");
        error(
                () ->
                        ai.submit(
                                USER,
                                outfit,
                                UUID.randomUUID().toString(),
                                Map.of("kind", "EVALUATION", "revision", "1")),
                "OUTFIT_CHANGED");
        error(
                () ->
                        ai.submit(
                                USER,
                                outfit,
                                UUID.randomUUID().toString(),
                                Map.of("kind", "EVALUATION", "revision", "0", "extra", true)),
                "VALIDATION_ERROR");
        p.setPlanApiKey("");
        error(() -> submit(outfit, "EVALUATION"), "GENERATION_UNAVAILABLE");
        verifyNoInteractions(gateway);
    }

    @Test
    void idempotencyStaleAndIndependentSnapshotsSurviveEditsDeletionAndProfileChanges() {
        String outfit = outfit(true), key = UUID.randomUUID().toString();
        var body = Map.<String, Object>of("kind", "EVALUATION", "revision", "0");
        var job = ai.submit(USER, outfit, key, body);
        assertThat(ai.submit(USER, outfit, key, body).get("taskId")).isEqualTo(job.get("taskId"));
        assertThat(ai.byKey(USER, key).get("taskId")).isEqualTo(job.get("taskId"));
        error(
                () -> ai.submit(USER, outfit, key, Map.of("kind", "EVALUATION", "revision", "1")),
                "IDEMPOTENCY_CONFLICT");
        error(() -> ai.detail(OTHER, (String) job.get("taskId")), "RESOURCE_NOT_FOUND");
        error(() -> submit(outfit, "EVALUATION"), "ACTIVE_TASK_EXISTS");
        outfits.patch(USER, outfit, Map.of("version", "0", "note", "卷起袖口"));
        jdbc.update("UPDATE dress SET name='已修改' WHERE id=?", TOP);
        jdbc.update("UPDATE `user` SET display_name='新资料' WHERE id=?", USER);
        run(job);
        assertThat(ai.detail(USER, (String) job.get("taskId")).get("stale")).isEqualTo(true);
        assertThat(workspace.detail(USER, (String) job.get("taskId")).getResult().getItems())
                .anyMatch(i -> i.getDressName().equals("白衬衫"));
        outfits.delete(USER, outfit, "1");
        assertThat(ai.detail(USER, (String) job.get("taskId")).get("status"))
                .isEqualTo("SUCCEEDED");
        assertThat(files.directReferences(PERSON + 1)).isGreaterThan(0);
    }

    @Test
    void imageUsesAllFixedItemsAndPersistsOutput() {
        var job = submit(outfit(true), "IMAGE");
        run(job);
        var result = ai.detail(USER, (String) job.get("taskId"));
        assertThat(result.get("status")).isEqualTo("SUCCEEDED");
        assertThat(result.get("outputFileId")).isNotNull();
        verify(gateway)
                .generate(
                        anyMap(),
                        contains("only supplied selected clothing"),
                        argThat(images -> images.size() == 3));
        assertThat(workspace.detail(USER, (String) job.get("taskId")).getResult().getItems())
                .hasSize(2);
        assertThat(workspace.detail(USER, (String) job.get("taskId")).getInputSummary())
                .containsEntry("personPhoto", Map.of("fileId", "" + PERSON));
    }

    @Test
    void technicalFailureRetryAndUnknownNeverAutomaticallyRetry() {
        doThrow(new GenerationFailure("PLAN_PROVIDER_FAILED", false))
                .when(gateway)
                .plan(anyMap(), anyString(), anyString(), anyList());
        String outfit = outfit(false);
        var job = submit(outfit, "EVALUATION");
        run(job);
        String task = (String) job.get("taskId");
        assertThat((List<String>) ai.detail(USER, task).get("actions"))
                .contains("RETRY_FULL")
                .doesNotContain("RETRY_IMAGE");
        error(
                () ->
                        ai.retry(
                                USER,
                                task,
                                UUID.randomUUID().toString(),
                                Map.of("mode", "IMAGE_ONLY")),
                "ACTION_NOT_ALLOWED");
        p.setImageApiKey("");
        var retry = ai.retry(USER, task, UUID.randomUUID().toString(), Map.of("mode", "FULL"));
        assertThat(retry.get("revision")).isEqualTo("0");
        doThrow(new GenerationFailure("EXTERNAL_RESULT_UNKNOWN", true))
                .when(gateway)
                .plan(anyMap(), anyString(), anyString(), anyList());
        run(retry);
        assertThat(ai.detail(USER, (String) retry.get("taskId")).get("status"))
                .isEqualTo("UNKNOWN");
        assertThat((List<String>) ai.detail(USER, (String) retry.get("taskId")).get("actions"))
                .containsExactly("VIEW");
        error(
                () ->
                        ai.retry(
                                USER,
                                (String) retry.get("taskId"),
                                UUID.randomUUID().toString(),
                                Map.of("mode", "FULL")),
                "ACTION_NOT_ALLOWED");
    }

    @Test
    void omittedFixedItemStopsBeforeImageAndFailedImageCanRetryOnlyImage() throws Exception {
        String outfit = outfit(true);
        doAnswer(
                        i -> {
                            var output =
                                    fixedPlan(json.readValue((String) i.getArgument(2), Map.class));
                            GenerationService.map(output.get("plan")).put("items", List.of());
                            return json.writeValueAsString(output);
                        })
                .when(gateway)
                .plan(anyMap(), anyString(), anyString(), anyList());
        var invalid = submit(outfit, "IMAGE");
        run(invalid);
        assertThat(ai.detail(USER, (String) invalid.get("taskId")).get("errorCode"))
                .isEqualTo("PLAN_OUTPUT_INVALID");
        verify(gateway, never()).generate(anyMap(), anyString(), anyList());
        doAnswer(
                        i ->
                                json.writeValueAsString(
                                        fixedPlan(
                                                json.readValue(
                                                        (String) i.getArgument(2), Map.class))))
                .when(gateway)
                .plan(anyMap(), anyString(), anyString(), anyList());
        doThrow(new GenerationFailure("IMAGE_PROVIDER_FAILED", false))
                .when(gateway)
                .generate(anyMap(), anyString(), anyList());
        var failed = submit(outfit, "IMAGE");
        run(failed);
        assertThat((List<String>) ai.detail(USER, (String) failed.get("taskId")).get("actions"))
                .contains("RETRY_IMAGE");
        var retry =
                ai.retry(
                        USER,
                        (String) failed.get("taskId"),
                        UUID.randomUUID().toString(),
                        Map.of("mode", "IMAGE_ONLY"));
        doReturn(GenerationIntegrationTest.image())
                .when(gateway)
                .generate(anyMap(), anyString(), anyList());
        run(retry);
        assertThat(ai.detail(USER, (String) retry.get("taskId")).get("status"))
                .isEqualTo("SUCCEEDED");
        verify(gateway, times(2)).plan(anyMap(), anyString(), anyString(), anyList());
    }

    @Test
    void deletedWardrobeSourceStillAllowsEvaluationButBlocksNewImage() {
        String outfit = outfit(true);
        jdbc.update("DELETE FROM dress_image WHERE user_id=? AND dress_id=?", USER, TOP);
        jdbc.update("DELETE FROM dress WHERE user_id=? AND id=?", USER, TOP);
        error(() -> submit(outfit, "IMAGE"), "DRESS_NOT_USABLE");
        var job = submit(outfit, "EVALUATION");
        run(job);
        assertThat(ai.detail(USER, (String) job.get("taskId")).get("status"))
                .isEqualTo("SUCCEEDED");
        assertThat(files.directReferences(PERSON + 1)).isGreaterThan(0);
        verify(gateway, never()).generate(anyMap(), anyString(), anyList());
    }

    @Test
    void expiredSentEvaluationIsUnknownAndNeverReissuedDuringRecovery() {
        var job = submit(outfit(false), "EVALUATION");
        String task = (String) job.get("taskId");
        var call =
                new HashMap<String, Object>(
                        Map.of(
                                "user",
                                USER,
                                "task",
                                Long.valueOf(task),
                                "stage",
                                "PLAN",
                                "provider",
                                "test",
                                "model",
                                "test"));
        tasks.call(call);
        jdbc.update(
                "UPDATE design_task SET status='PLANNING',attempt_token='expired',current_call_id=?,lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE user_id=? AND id=?",
                call.get("id"),
                USER,
                Long.valueOf(task));
        executor.recover();
        assertThat(ai.detail(USER, task).get("status")).isEqualTo("UNKNOWN");
        assertThat((List<String>) ai.detail(USER, task).get("actions")).containsExactly("VIEW");
        executor.recover();
        verifyNoInteractions(gateway);
    }
}
