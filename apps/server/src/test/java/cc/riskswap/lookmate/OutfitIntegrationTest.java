package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.OutfitDto;
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
@org.springframework.test.context.bean.override.mockito.MockitoBean(
        types = {
            cc.riskswap.lookmate.scheduler.AssetScheduler.class,
            cc.riskswap.lookmate.scheduler.RecognitionScheduler.class,
            cc.riskswap.lookmate.scheduler.GenerationScheduler.class
        })
class OutfitIntegrationTest {
    private static final long USER = -1401, OTHER = -1402, FILE = 9007199254801000L;
    @Autowired OutfitService service;
    @Autowired WardrobeService wardrobe;
    @Autowired FileMapper files;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean OutfitMapper mapper;
    @MockitoBean RecognitionAvailability availability;
    private String dress;

    @BeforeEach
    void setup() {
        clean();
        when(availability.available()).thenReturn(false);
        when(availability.configSnapshot()).thenReturn("{}");
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    "outfit_test_" + -user);
        jdbc.update(
                "INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,width,height,created_at,updated_at) VALUES(?,?,'test','outfit-test','READY','image/jpeg',100,10,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
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
    }

    @AfterEach
    void clean() {
        reset(mapper);
        for (String table :
                List.of(
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
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    private OutfitDto create(String name) {
        return service.create(USER, Map.of("name", name, "dressIds", List.of(dress)));
    }

    private void error(Runnable operation, String code) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    @Test
    void incompleteCombinationSnapshotsRemainAfterSourceChangesAndDeletion() {
        var outfit = create("通勤");
        assertThat(outfit.getRevision()).isEqualTo("0");
        wardrobe.patch(USER, dress, Map.of("name", "后来改名"));
        var edited =
                service.patch(
                        USER,
                        outfit.getId(),
                        Map.of("version", "0", "dressIds", List.of(dress), "name", "通勤新名"));
        assertThat(edited.getRevision()).isEqualTo("0");
        assertThat(edited.getItems().getFirst()).containsEntry("dressName", "白衬衫");
        wardrobe.delete(USER, dress);
        assertThat(service.detail(USER, outfit.getId()).getItems().getFirst())
                .containsEntry("missing", true);
        assertThat(files.directReferences(FILE)).isEqualTo(1);
        service.patch(USER, outfit.getId(), Map.of("version", "1", "note", "塞前摆"));
        error(() -> service.snapshotForGeneration(USER, outfit.getId(), "0"), "OUTFIT_CHANGED");
        assertThat(service.snapshotForGeneration(USER, outfit.getId(), "1"))
                .containsEntry("note", "塞前摆");
        service.delete(USER, outfit.getId(), "2");
        assertThat(files.directReferences(FILE)).isZero();
    }

    @Test
    void groupingPinningPaginationOwnershipAndVersion() {
        var group = service.createGroup(USER, Map.of("name", "工作日"));
        var otherGroup = service.createGroup(USER, Map.of("name", "周末"));
        var first = create("first");
        create("second");
        create("third");
        service.patch(
                USER,
                first.getId(),
                Map.of(
                        "version",
                        "0",
                        "pinned",
                        true,
                        "groupIds",
                        List.of(group.getId(), otherGroup.getId())));
        var page = service.list(USER, "1", "2", null);
        assertThat(page.getTotal()).isEqualTo(3);
        assertThat(page.getItems()).hasSize(2);
        assertThat(page.getItems().getFirst().getId()).isEqualTo(first.getId());
        assertThat(service.list(USER, "2", "2", null).getItems()).hasSize(1);
        service.deleteGroup(USER, group.getId(), "0");
        var after = service.detail(USER, first.getId());
        assertThat(after.getVersion()).isEqualTo("2");
        assertThat(after.getRevision()).isEqualTo("0");
        assertThat(after.getGroups())
                .extracting(g -> g.getId())
                .containsExactly(otherGroup.getId());
        assertThat(service.list(USER, null, null, otherGroup.getId()).getTotal()).isEqualTo(1);
        error(
                () -> service.patch(USER, first.getId(), Map.of("version", "1", "name", "stale")),
                "VERSION_CONFLICT");
        error(() -> service.detail(OTHER, first.getId()), "OUTFIT_NOT_FOUND");
        error(() -> service.delete(OTHER, first.getId(), "2"), "OUTFIT_NOT_FOUND");
        error(() -> service.createGroup(USER, Map.of("name", "周末")), "OUTFIT_GROUP_NAME_EXISTS");
        error(
                () ->
                        service.patchGroup(
                                OTHER,
                                otherGroup.getId(),
                                Map.of("version", "0", "name", "foreign")),
                "OUTFIT_GROUP_NOT_FOUND");
    }

    @Test
    void strictInputAndFailedWritesRollback() {
        error(
                () ->
                        service.create(
                                USER,
                                Map.of(
                                        "name",
                                        "test",
                                        "dressIds",
                                        List.of(dress),
                                        "unexpected",
                                        true)),
                "VALIDATION_ERROR");
        error(
                () ->
                        service.create(
                                USER, Map.of("name", "test", "dressIds", List.of(dress, dress))),
                "VALIDATION_ERROR");
        error(
                () ->
                        service.create(
                                USER,
                                Map.of("name", "test", "dressIds", List.of("9223372036854775806"))),
                "DRESS_NOT_USABLE");
        error(() -> service.list(USER, "0", "20", null), "VALIDATION_ERROR");
        doThrow(new IllegalStateException("injected write failure"))
                .when(mapper)
                .asset(eq(USER), anyLong(), eq(FILE));
        assertThatThrownBy(() -> create("rollback")).isInstanceOf(IllegalStateException.class);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM outfit WHERE user_id=?", Long.class, USER))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM outfit_item WHERE user_id=?",
                                Long.class,
                                USER))
                .isZero();
    }

    @Test
    void fromDesignCopiesSelectedHistoricalItemsAndSurvivesSourceDeletion() {
        long task = 9007199254801100L, result = task + 1;
        String snapshot =
                "{\"candidateItems\":[{\"dressId\":\""
                        + dress
                        + "\",\"name\":\"原方案衬衫\",\"categoryCode\":\"TOP\",\"categoryName\":\"上装\",\"images\":[{\"fileId\":\""
                        + FILE
                        + "\",\"features\":{}}]}]}";
        String categoryCode = wardrobe.categories().getFirst().getCode();
        snapshot = snapshot.replace("TOP", categoryCode);
        jdbc.update(
                "INSERT INTO design_task(id,user_id,design_type,status,client_request_id,request_hash,input_snapshot,model_config_snapshot,created_at,updated_at) VALUES(?,?,'OUTFIT','SUCCEEDED',?,'test',?,'{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                task,
                USER,
                UUID.randomUUID().toString(),
                snapshot);
        jdbc.update(
                "INSERT INTO design_result(id,user_id,task_id,title,style,occasion,summary,design_reason,color_advice,wearing_advice,image_prompt,plan_provenance,created_at,updated_at) VALUES(?,?,?,'原方案','simple','daily','summary','reason','color','wear','image','{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                result,
                USER,
                task);
        jdbc.update(
                "INSERT INTO design_result_item(user_id,result_id,dress_id,dress_name,category_name,match_reason,wearing_method,sort_order,created_at,updated_at) VALUES(?,?,?,'旧衬衫','上装','match','wear',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                result,
                Long.valueOf(dress));
        error(() -> service.fromDesign(USER, "" + task, Map.of()), "DESIGN_NOT_FOUND");
        jdbc.update(
                "INSERT INTO design_task_asset(user_id,task_id,asset_id,role,position,created_at,updated_at) VALUES(?,?,?,'OUTPUT',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                task,
                FILE);
        jdbc.update(
                "INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,width,height,created_at,updated_at) VALUES(?,?,'test','outfit-output','READY','image/jpeg',100,10,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                FILE + 1,
                USER);
        jdbc.update("UPDATE design_task_asset SET asset_id=? WHERE task_id=?", FILE + 1, task);
        jdbc.update(
                "UPDATE design_result SET wearing_advice=? WHERE id=?", "长".repeat(2100), result);
        wardrobe.delete(USER, dress);
        var copied = service.fromDesign(USER, "" + task, Map.of());
        assertThat(copied.getItems().getFirst())
                .containsEntry("dressName", "原方案衬衫")
                .containsEntry("missing", true);
        assertThat(copied.getSourceOutputFileId()).isEqualTo("" + (FILE + 1));
        assertThat(copied.getNote()).hasSize(2000);
        error(
                () -> service.fromDesign(USER, "" + task, Map.of("name", "名".repeat(101))),
                "VALIDATION_ERROR");
        service.patch(
                USER,
                copied.getId(),
                Map.of("version", "0", "name", "自己的名称", "dressIds", List.of(dress)));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT title FROM design_result WHERE id=?", String.class, result))
                .isEqualTo("原方案");
        jdbc.update("DELETE FROM design_task_asset WHERE task_id=?", task);
        jdbc.update("DELETE FROM design_result_item WHERE result_id=?", result);
        jdbc.update("DELETE FROM design_result WHERE id=?", result);
        jdbc.update("DELETE FROM design_task WHERE id=?", task);
        assertThat(files.directReferences(FILE)).isEqualTo(1);
        assertThat(service.detail(USER, copied.getId()).getItems()).hasSize(1);
        // The outfit keeps both an immutable asset snapshot and its source output pointer.
        assertThat(files.directReferences(FILE + 1)).isEqualTo(2);
        service.delete(USER, copied.getId(), "1");
        assertThat(files.directReferences(FILE + 1)).isZero();
    }

    @Test
    void concurrentEditorsCannotOverwriteOneAnother() throws Exception {
        var outfit = create("before");
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = new ArrayList<Future<String>>();
            for (int i = 0; i < 2; i++) {
                int index = i;
                futures.add(
                        pool.submit(
                                () -> {
                                    start.await();
                                    try {
                                        service.patch(
                                                USER,
                                                outfit.getId(),
                                                Map.of("version", "0", "name", "editor" + index));
                                        return "OK";
                                    } catch (ApiException e) {
                                        return e.getCode();
                                    }
                                }));
            }
            start.countDown();
            assertThat(List.of(futures.get(0).get(), futures.get(1).get()))
                    .containsExactlyInAnyOrder("OK", "VERSION_CONFLICT");
        }
        assertThat(service.detail(USER, outfit.getId()).getVersion()).isEqualTo("1");
    }
}
