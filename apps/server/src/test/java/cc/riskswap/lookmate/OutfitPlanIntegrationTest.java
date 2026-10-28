package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.service.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.*;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest
@MockitoBean(
        types = {
            cc.riskswap.lookmate.scheduler.AssetScheduler.class,
            cc.riskswap.lookmate.scheduler.RecognitionScheduler.class,
            cc.riskswap.lookmate.scheduler.GenerationScheduler.class
        })
class OutfitPlanIntegrationTest {
    private static final long USER = -1801, OTHER = -1802, FILE = 9007199254808000L;
    @Autowired OutfitPlanService plans;
    @Autowired OutfitService outfits;
    @Autowired WardrobeService wardrobe;
    @Autowired FileMapper files;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean OutfitPlanMapper mapper;
    @MockitoBean RecognitionAvailability availability;
    private String dress;
    private OutfitDto outfit;

    @BeforeEach
    void setup() {
        clean();
        when(availability.available()).thenReturn(false);
        when(availability.configSnapshot()).thenReturn("{}");
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO user(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    "calendar_test_" + -user);
        jdbc.update(
                "INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,created_at,updated_at) VALUES(?,?,'test','calendar-test','READY','image/jpeg',100,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                FILE,
                USER);
        dress =
                wardrobe.create(
                                USER,
                                Map.of(
                                        "name",
                                        "白衬衫",
                                        "categoryId",
                                        wardrobe.categories().getFirst().getId(),
                                        "images",
                                        List.of(Map.of("fileId", "" + FILE))))
                        .getId();
        outfit =
                outfits.create(
                        USER, Map.of("name", "通勤组合", "note", "卷袖", "dressIds", List.of(dress)));
    }

    @AfterEach
    void clean() {
        reset(mapper);
        for (String table :
                List.of(
                        "outfit_plan_asset",
                        "outfit_plan",
                        "outfit_scene",
                        "outfit_scene_option",
                        "outfit_group_member",
                        "outfit_group",
                        "outfit_item_asset",
                        "outfit_item",
                        "outfit",
                        "design_result_item",
                        "design_result",
                        "design_task_asset",
                        "design_task",
                        "model_call",
                        "dress_recognition",
                        "dress_image",
                        "dress",
                        "file_asset"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM user WHERE id IN (?,?)", USER, OTHER);
    }

    private Map<String, Object> body() {
        return new LinkedHashMap<>(
                Map.of(
                        "clientRequestId",
                        UUID.randomUUID().toString(),
                        "date",
                        "2026-10-28",
                        "scene",
                        "通勤",
                        "outfitId",
                        outfit.getId()));
    }

    private void error(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    private OutfitPlanDto get(String id) {
        return plans.list(USER, "2026-10-28", "1", "100").getItems().stream()
                .filter(p -> p.getId().equals(id))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void snapshotsAndAssetsSurviveSourceEditAndDeletion() {
        var plan = plans.create(USER, body());
        assertThat(files.directReferences(FILE)).isEqualTo(3);
        outfits.patch(USER, outfit.getId(), Map.of("version", "0", "note", "新穿法", "name", "新名称"));
        var edited = plans.patch(USER, plan.getId(), Map.of("version", "0", "note", "晚上"));
        assertThat(edited.getOutfit().getName()).isEqualTo("通勤组合");
        assertThat(edited.getOutfit().getNote()).isEqualTo("卷袖");
        var replaced =
                plans.patch(USER, plan.getId(), Map.of("version", "1", "outfitId", outfit.getId()));
        assertThat(replaced.getOutfit().getNote()).isEqualTo("新穿法");
        outfits.delete(USER, outfit.getId(), "1");
        wardrobe.delete(USER, dress);
        var saved = get(plan.getId());
        assertThat(saved.isSourceMissing()).isTrue();
        assertThat(saved.getOutfit().getItems().getFirst())
                .containsEntry("missing", true)
                .containsEntry("dressName", "白衬衫");
        assertThat(files.directReferences(FILE)).isEqualTo(1);
        plans.delete(USER, plan.getId(), "2");
        assertThat(files.directReferences(FILE)).isZero();
    }

    @Test
    void idempotencyNormalizesPayloadAndRetainsOriginalHashAcrossUpdates() {
        var body = body();
        var first = plans.create(USER, body);
        body.put("scene", " 通勤 ");
        assertThat(plans.create(USER, body).getId()).isEqualTo(first.getId());
        plans.patch(USER, first.getId(), Map.of("version", "0", "note", "已修改"));
        assertThat(plans.create(USER, body).getNote()).isEqualTo("已修改");
        body.put("scene", "聚会");
        error(() -> plans.create(USER, body), "IDEMPOTENCY_CONFLICT");
        assertThat(plans.list(USER, "2026-10-28", null, null).getTotal()).isEqualTo(1);
    }

    @Test
    void clearVersusOmittedAndDayPagination() {
        var body = body();
        var first = plans.create(USER, body);
        var pending = body();
        pending.remove("outfitId");
        pending.put("scene", "见客户");
        var second = plans.create(USER, pending);
        assertThat(second.getOutfit()).isNull();
        var page = plans.list(USER, "2026-10-28", "1", "1");
        assertThat(page.getTotal()).isEqualTo(2);
        assertThat(page.getItems()).hasSize(1);
        assertThat(plans.list(USER, "2026-10-28", "2", "1").getItems().getFirst().getId())
                .isEqualTo(first.getId());
        var patch = new LinkedHashMap<String, Object>();
        patch.put("version", "0");
        patch.put("outfitId", null);
        patch.put("note", null);
        assertThat(plans.patch(USER, first.getId(), patch).getOutfit()).isNull();
        assertThat(files.directReferences(FILE)).isEqualTo(2);
        assertThat(plans.calendar(USER, "2026-10-01", "2026-11-11").get("days").toString())
                .contains("2026-10-28", "2");
    }

    @Test
    void permissionsVersionDateAndUnknownFieldsReject() {
        var plan = plans.create(USER, body());
        assertThat(plans.list(OTHER, "2026-10-28", null, null).getTotal()).isZero();
        assertThat(plans.calendar(OTHER, "2026-10-28", "2026-10-28").get("days"))
                .isEqualTo(List.of());
        error(
                () -> plans.patch(OTHER, plan.getId(), Map.of("version", "0", "note", "越权")),
                "OUTFIT_PLAN_NOT_FOUND");
        error(() -> plans.create(OTHER, body()), "OUTFIT_NOT_FOUND");
        error(() -> plans.delete(USER, plan.getId(), "1"), "VERSION_CONFLICT");
        error(() -> plans.list(USER, "2026-02-30", null, null), "INVALID_REQUEST");
        error(() -> plans.list(USER, "2026-10-28", "0", "1"), "INVALID_REQUEST");
        error(() -> plans.calendar(USER, "2026-10-01", "2026-11-12"), "INVALID_REQUEST");
        error(() -> plans.calendar(USER, "2026-10-02", "2026-10-01"), "INVALID_REQUEST");
        var unknown = body();
        unknown.put("userId", "1");
        error(() -> plans.create(USER, unknown), "INVALID_REQUEST");
    }

    @Test
    void scenesAreIndependentPaginatedAndVersionedWithoutRevisionChange() {
        var tagged =
                outfits.setScenes(
                        USER,
                        outfit.getId(),
                        Map.of("version", "0", "scenes", List.of("通勤", "参加婚礼", "通勤")));
        assertThat(tagged.getScenes()).containsExactly("通勤", "参加婚礼");
        assertThat(tagged.getRevision()).isEqualTo("0");
        assertThat(tagged.getVersion()).isEqualTo("1");
        assertThat(outfits.list(USER, "1", "1", null, "参加婚礼").getTotal()).isEqualTo(1);
        assertThat(outfits.list(USER, "1", "1", null, "运动").getTotal()).isZero();
        assertThat(outfits.sceneOptions(USER, "2", "6").getItems())
                .containsExactly(Map.of("name", "参加婚礼"));
        assertThat(outfits.sceneOptions(OTHER, "1", "20").getTotal()).isEqualTo(6);
        error(
                () ->
                        outfits.setScenes(
                                USER, outfit.getId(), Map.of("version", "0", "scenes", List.of())),
                "VERSION_CONFLICT");
        outfits.delete(USER, outfit.getId(), "1");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM outfit_scene WHERE user_id=?",
                                Long.class,
                                USER))
                .isZero();
    }

    @Test
    void failedAssetInsertRollsBackPlanAndSceneAndReferences() {
        doThrow(new IllegalStateException("injected write failure"))
                .when(mapper)
                .asset(eq(USER), anyLong(), eq(FILE));
        var body = body();
        body.put("scene", "事务失败场景");
        assertThatThrownBy(() -> plans.create(USER, body))
                .isInstanceOf(IllegalStateException.class);
        assertThat(plans.list(USER, "2026-10-28", null, null).getTotal()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM outfit_plan_asset WHERE user_id=?",
                                Long.class,
                                USER))
                .isZero();
        assertThat(outfits.sceneOptions(USER, "1", "20").getTotal()).isEqualTo(6);
        assertThat(files.directReferences(FILE)).isEqualTo(2);
    }

    @Test
    void failedReplacementRollsBackSnapshotAndVersion() {
        var plan = plans.create(USER, body());
        doThrow(new IllegalStateException("injected update failure")).when(mapper).update(any());
        var patch = new LinkedHashMap<String, Object>();
        patch.put("version", "0");
        patch.put("outfitId", null);
        assertThatThrownBy(() -> plans.patch(USER, plan.getId(), patch))
                .isInstanceOf(IllegalStateException.class);
        assertThat(get(plan.getId()).getVersion()).isEqualTo("0");
        assertThat(get(plan.getId()).getOutfit()).isNotNull();
        assertThat(files.directReferences(FILE)).isEqualTo(3);
    }

    @Test
    void concurrentSameKeyCreatesOneRecordAndConcurrentVersionHasOneWinner() throws Exception {
        var body = body();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var gate = new CountDownLatch(1);
            Callable<String> create =
                    () -> {
                        gate.await();
                        return plans.create(USER, body).getId();
                    };
            var first = executor.submit(create);
            var second = executor.submit(create);
            gate.countDown();
            assertThat(first.get(15, TimeUnit.SECONDS)).isEqualTo(second.get(15, TimeUnit.SECONDS));
            String id = first.get();
            var editGate = new CountDownLatch(1);
            Callable<String> update =
                    () -> {
                        editGate.await();
                        try {
                            plans.patch(USER, id, Map.of("version", "0", "note", "更新"));
                            return "OK";
                        } catch (ApiException e) {
                            return e.getCode();
                        }
                    };
            var a = executor.submit(update);
            var b = executor.submit(update);
            editGate.countDown();
            assertThat(List.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("OK", "VERSION_CONFLICT");
        }
    }
}
