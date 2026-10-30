package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.dao.mapper.RecordsMapper;
import cc.riskswap.lookmate.service.RecordsService;
import cc.riskswap.lookmate.service.WorkspaceService;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest
class RecordsIntegrationTest {
    private static final long USER = -801;
    private static final long OTHER = -802;
    private static final long BASE = 9007199254750000L;
    @Autowired
    private RecordsService service;
    @Autowired
    private WorkspaceService workspace;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private org.springframework.web.context.WebApplicationContext webContext;
    @MockitoSpyBean
    private RecordsMapper mapper;

    @BeforeEach
    void setup() {
        clean();
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    """
                INSERT INTO `user` (id,username,password_hash,created_at,updated_at)
                VALUES (?,?,'TEST_ONLY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
                """,
                    user,
                    "records_test_" + -user);
    }

    @AfterEach
    void clean() {
        reset(mapper);
        for (String table :
                List.of(
                        "favorite_folder_item",
                        "favorite_folder",
                        "design_favorite",
                        "design_result",
                        "design_task"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    @Test
    void designScopeUsesSnapshotAndCountMatchesPage() {
        task(BASE, USER, "SUCCEEDED", false);
        task(BASE + 1, USER, "SUCCEEDED", false);
        jdbc.update(
                "UPDATE design_task SET input_snapshot=JSON_OBJECT('schemaVersion',3,'fixedOutfit',false,'outfitInspirationReference',NULL) WHERE id=?",
                BASE);
        jdbc.update(
                "UPDATE design_task SET input_snapshot=JSON_OBJECT('schemaVersion',3,'fixedOutfit',true,'outfitInspirationReference',NULL) WHERE id=?",
                BASE + 1);
        assertThat(service.designs(USER, "1", "1", "OUTFIT", null, "all").getTotal()).isEqualTo(2);
        var ordinary = service.designs(USER, "1", "1", "OUTFIT", null, "design");
        assertThat(ordinary.getTotal()).isEqualTo(1);
        assertThat(ordinary.getItems())
                .extracting(row -> row.getId())
                .containsExactly(Long.toString(BASE));
        assertThat(service.designs(USER, "2", "1", "OUTFIT", null, "design").getItems()).isEmpty();
    }

    @Test
    void listPaginationFiltersOwnershipAndHiddenWithLargeOffsets() {
        task(BASE, USER, "SUCCEEDED", false);
        task(BASE + 1, USER, "FAILED", false);
        task(BASE + 2, USER, "UNKNOWN", false);
        task(BASE + 3, USER, "SUCCEEDED", true);
        task(BASE + 4, OTHER, "SUCCEEDED", false);
        var page = service.designs(USER, "1", "2", null, null, null);
        assertThat(page.getTotal()).isEqualTo(3);
        assertThat(page.getItems())
                .extracting(t -> t.getId())
                .containsExactly("" + (BASE + 2), "" + (BASE + 1));
        assertThat(service.designs(USER, "2", "2", null, null, null).getItems()).hasSize(1);
        assertThat(service.designs(USER, "2147483647", "100", null, null, null).getItems())
                .isEmpty();
        assertThat(service.designs(USER, null, null, "HAIRSTYLE", null, null).getTotal()).isZero();
        assertThat(service.designs(USER, null, null, "OUTFIT", "FAILED", null).getTotal())
                .isEqualTo(1);
        for (String bad : List.of("", "0", "-1", "1.2", "2147483648", "9223372036854775808"))
            error(() -> service.designs(USER, bad, null, null, null, null), "INVALID_REQUEST");
        error(() -> service.designs(USER, null, "101", null, null, null), "INVALID_REQUEST");
        error(() -> service.designs(USER, null, null, "", null, null), "INVALID_REQUEST");
        error(() -> service.designs(USER, null, null, null, "SUCCESS", null), "INVALID_REQUEST");
    }

    @Test
    void favoriteMembershipLifecyclePreservesOtherFoldersAndResults() {
        task(BASE, USER, "SUCCEEDED", false);
        var favorite = service.favorite(USER, "" + BASE);
        var again = service.favorite(USER, "" + BASE);
        assertThat(again.getId()).isEqualTo(favorite.getId());
        assertThat(again.getCreatedAt()).isEqualTo(favorite.getCreatedAt());
        assertThat(workspace.detail(USER, "" + BASE).getActions())
                .containsExactly("VIEW", "UNFAVORITE", "DELETE");
        var a = service.createCollection(USER, "A");
        var b = service.createCollection(USER, "B");
        service.membership(USER, a.getId(), favorite.getId(), true);
        service.membership(USER, a.getId(), favorite.getId(), true);
        service.membership(USER, b.getId(), favorite.getId(), true);
        assertThat(
                        service.favorites(USER, null, null, a.getId())
                                .getItems()
                                .getFirst()
                                .getCollectionIds())
                .containsExactlyInAnyOrder(a.getId(), b.getId());
        service.membership(USER, a.getId(), favorite.getId(), false);
        assertThat(service.favorites(USER, null, null, a.getId()).getTotal()).isZero();
        service.membership(USER, a.getId(), favorite.getId(), true);
        service.deleteCollection(USER, a.getId());
        assertThat(service.favorites(USER, null, null, b.getId()).getTotal()).isEqualTo(1);
        assertThat(
                        service.favorites(USER, null, null, null)
                                .getItems()
                                .getFirst()
                                .getCollectionIds())
                .containsExactly(b.getId());
        service.unfavorite(USER, "" + BASE);
        service.unfavorite(USER, "" + BASE);
        assertThat(service.favorites(USER, null, null, b.getId()).getTotal()).isZero();
        assertThat(count("favorite_folder_item")).isZero();
        assertThat(workspace.detail(USER, "" + BASE).getResult()).isNotNull();
        assertThat(workspace.detail(USER, "" + BASE).getActions())
                .containsExactly("VIEW", "FAVORITE", "DELETE");
    }

    @Test
    void rejectsForeignHiddenAndUnsuccessfulResources() {
        task(BASE, USER, "FAILED", false);
        task(BASE + 1, USER, "UNKNOWN", false);
        task(BASE + 2, USER, "SUCCEEDED", true);
        task(BASE + 3, OTHER, "SUCCEEDED", false);
        task(BASE + 4, USER, "SUCCEEDED", false);
        error(() -> service.favorite(USER, "" + BASE), "DESIGN_NOT_SUCCEEDED");
        error(() -> service.favorite(USER, "" + (BASE + 1)), "DESIGN_NOT_SUCCEEDED");
        for (long id : new long[] {BASE + 2, BASE + 3, Long.MAX_VALUE}) {
            error(() -> service.favorite(USER, "" + id), "RESULT_NOT_FOUND");
            error(() -> service.unfavorite(USER, "" + id), "RESULT_NOT_FOUND");
        }
        var foreignFolder = service.createCollection(OTHER, "other");
        var ownFolder = service.createCollection(USER, "own");
        var foreignFavorite = service.favorite(OTHER, "" + (BASE + 3));
        var ownFavorite = service.favorite(USER, "" + (BASE + 4));
        error(
                () -> service.favorites(USER, null, null, foreignFolder.getId()),
                "COLLECTION_NOT_FOUND");
        error(() -> service.collection(USER, foreignFolder.getId()), "COLLECTION_NOT_FOUND");
        error(() -> service.collection(USER, "9223372036854775807"), "COLLECTION_NOT_FOUND");
        assertThat(service.collection(USER, ownFolder.getId()).getName()).isEqualTo("own");
        error(() -> service.deleteCollection(USER, foreignFolder.getId()), "COLLECTION_NOT_FOUND");
        error(
                () -> service.membership(USER, ownFolder.getId(), foreignFavorite.getId(), true),
                "FAVORITE_NOT_FOUND");
        error(
                () -> service.membership(USER, foreignFolder.getId(), ownFavorite.getId(), true),
                "COLLECTION_NOT_FOUND");
        jdbc.update("UPDATE design_task SET hidden_at = UTC_TIMESTAMP(3) WHERE id = ?", BASE + 4);
        assertThat(service.favorites(USER, null, null, null).getTotal()).isZero();
        error(
                () -> service.membership(USER, ownFolder.getId(), ownFavorite.getId(), true),
                "FAVORITE_NOT_FOUND");
    }

    @Test
    void normalizesNamesValidatesCodePointsAndUsesVersionConflicts() {
        var a = service.createCollection(USER, "\u0085\u00a0 e\u0301\u3000");
        assertThat(a.getName()).isEqualTo("é");
        error(() -> service.createCollection(USER, "é"), "COLLECTION_NAME_EXISTS");
        service.createCollection(USER, "É");
        for (String bad : List.of("", " \u0085\u00a0", "字".repeat(65), "😀".repeat(65)))
            error(() -> service.createCollection(USER, bad), "VALIDATION_ERROR");
        service.createCollection(USER, "😀".repeat(64));
        error(() -> service.createCollection(USER, null), "VALIDATION_ERROR");
        var changed = service.renameCollection(USER, a.getId(), "new", a.getVersion());
        assertThat(changed.getVersion()).isEqualTo("1");
        error(
                () -> service.renameCollection(USER, a.getId(), "stale", a.getVersion()),
                "VERSION_CONFLICT");
        error(
                () -> service.renameCollection(USER, a.getId(), "bad", "9223372036854775808"),
                "VALIDATION_ERROR");
        assertThat(service.collections(USER, "1", "1").getTotal()).isEqualTo(3);
        assertThat(service.collections(USER, "2147483647", "100").getItems()).isEmpty();
    }

    @Test
    void concurrentFavoritesAndMembershipsHaveSingleRowsAndRenameHasOneWinner() throws Exception {
        task(BASE, USER, "SUCCEEDED", false);
        var results = concurrent(() -> service.favorite(USER, "" + BASE).getId());
        assertThat(results).containsOnly(results.getFirst());
        assertThat(count("design_favorite")).isEqualTo(1);
        var folder = service.createCollection(USER, "parallel");
        concurrent(
                () -> {
                    service.membership(USER, folder.getId(), results.getFirst(), true);
                    return "ok";
                });
        assertThat(count("favorite_folder_item")).isEqualTo(1);
        var renamed =
                concurrent(
                        () -> {
                            try {
                                service.renameCollection(USER, folder.getId(), "renamed", "0");
                                return "ok";
                            } catch (ApiException error) {
                                return error.getCode();
                            }
                        });
        assertThat(renamed.stream().filter("ok"::equals).count()).isEqualTo(1);
        assertThat(renamed.stream().filter("VERSION_CONFLICT"::equals).count()).isEqualTo(3);
    }

    @Test
    void failureBetweenMembershipAndFavoriteDeletionRollsBackCommittedDatabaseState() {
        task(BASE, USER, "SUCCEEDED", false);
        var favorite = service.favorite(USER, "" + BASE);
        var folder = service.createCollection(USER, "rollback");
        service.membership(USER, folder.getId(), favorite.getId(), true);
        doThrow(new IllegalStateException("injected after membership delete"))
                .when(mapper)
                .deleteFavorite(USER, Long.valueOf(favorite.getId()));
        assertThatThrownBy(() -> service.unfavorite(USER, "" + BASE))
                .isInstanceOf(IllegalStateException.class);
        // No surrounding test transaction: these are independent reads after the proxied service
        // rolled back.
        assertThat(count("favorite_folder_item")).isEqualTo(1);
        assertThat(count("design_favorite")).isEqualTo(1);
        assertThat(count("design_result")).isEqualTo(1);
    }

    @Test
    void mvcUsesStrictJsonAndRejectsBodiesOnBodylessWrites() throws Exception {
        var mvc =
                org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(
                                webContext)
                        .build();
        var account =
                new cc.riskswap.lookmate.common.model.dto.AccountDto(
                        Long.toString(USER), "records_test_801", null);
        for (String body :
                List.of(
                        "{}",
                        "{\"name\":null}",
                        "{\"name\":42}",
                        "{\"name\":true}",
                        "{\"name\":[]}",
                        "{\"name\":\"ok\",\"owner\":1}")) {
            mvc.perform(
                            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                                    .post("/api/collections")
                                    .requestAttr(
                                            cc.riskswap.lookmate.common.filter.AuthGuardFilter
                                                    .ACCOUNT,
                                            account)
                                    .requestAttr(
                                            cc.riskswap.lookmate.common.api.ApiErrors.REQUEST_ID,
                                            "records-http-test")
                                    .contentType("application/json")
                                    .content(body))
                    .andExpect(
                            org.springframework.test.web.servlet.result.MockMvcResultMatchers
                                    .status()
                                    .isBadRequest())
                    .andExpect(
                            org.springframework.test.web.servlet.result.MockMvcResultMatchers
                                    .jsonPath("$.code")
                                    .value("VALIDATION_ERROR"));
        }
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(
                                        "/api/favorites/1")
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account)
                                .requestAttr(
                                        cc.riskswap.lookmate.common.api.ApiErrors.REQUEST_ID,
                                        "records-http-test")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isBadRequest());
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                        "/api/designs?page=")
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account)
                                .requestAttr(
                                        cc.riskswap.lookmate.common.api.ApiErrors.REQUEST_ID,
                                        "records-http-test"))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isBadRequest())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                                        "$.code")
                                .value("INVALID_REQUEST"));
        assertThat(count("favorite_folder")).isZero();
    }

    private List<String> concurrent(java.util.concurrent.Callable<String> action) throws Exception {
        var start = new CountDownLatch(1);
        var ready = new CountDownLatch(4);
        try (var pool = Executors.newFixedThreadPool(4)) {
            var futures =
                    java.util.stream.IntStream.range(0, 4)
                            .mapToObj(
                                    i ->
                                            pool.submit(
                                                    () -> {
                                                        ready.countDown();
                                                        start.await();
                                                        return action.call();
                                                    }))
                            .toList();
            assertThat(ready.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            start.countDown();
            var values = new java.util.ArrayList<String>();
            for (var future : futures)
                values.add(future.get(15, java.util.concurrent.TimeUnit.SECONDS));
            return values;
        }
    }

    private long count(String table) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE user_id = ?", Long.class, USER);
    }

    private void error(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class, error -> assertThat(error.getCode()).isEqualTo(code));
    }

    private void task(long id, long user, String status, boolean hidden) {
        jdbc.update(
                """
                INSERT INTO design_task (id,user_id,design_type,status,client_request_id,request_hash,input_snapshot,model_config_snapshot,hidden_at,created_at,updated_at)
                VALUES (?,?,'OUTFIT',?,?,REPEAT('a',64),'{}','{}',?,'2026-10-20 01:02:03.123','2026-10-20 01:02:03.123')
                """,
                id,
                user,
                status,
                "" + id,
                hidden ? "2026-10-20 02:00:00" : null);
        jdbc.update(
                """
                INSERT INTO design_result (id,user_id,task_id,title,summary,style,occasion,design_reason,image_prompt,plan_provenance,created_at,updated_at)
                VALUES (?,?,?,'title','summary','style','occasion','reason','prompt','{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
                """,
                id,
                user,
                id);
    }
}
