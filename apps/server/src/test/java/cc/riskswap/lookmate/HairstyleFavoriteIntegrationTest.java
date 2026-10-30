package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.service.HairstyleCatalogService;
import cc.riskswap.lookmate.service.HairstyleFavoriteService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(properties = "lookmate.hairstyles.current-version=v999")
@org.springframework.test.context.bean.override.mockito.MockitoBean(
        types = {
            cc.riskswap.lookmate.scheduler.AssetScheduler.class,
            cc.riskswap.lookmate.scheduler.RecognitionScheduler.class,
            cc.riskswap.lookmate.scheduler.GenerationScheduler.class
        })
class HairstyleFavoriteIntegrationTest {
    private static final long USER = -30101, OTHER = -30102;
    @Autowired HairstyleFavoriteService service;
    @Autowired HairstyleCatalogService catalog;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @BeforeEach
    void setup() {
        clean();
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    "hair_favorite_" + -user);
    }

    @AfterEach
    void clean() {
        jdbc.update("DELETE FROM hairstyle_favorite WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    @Test
    void repeatedAndConcurrentFavoritesRemainUniqueAndPrivate() throws Exception {
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> service.favorite(USER, "test-0"));
            var b = pool.submit(() -> service.favorite(USER, "test-0"));
            var first = a.get();
            var second = b.get();
            assertThat(first.created()).isNotEqualTo(second.created());
            assertThat(first.data()).isEqualTo(second.data());
        }
        assertThat(service.list(USER, "1", "1", null, null, null, "favorites").getTotal())
                .isEqualTo(1);
        assertThat(service.list(OTHER, "1", "1", null, null, null, "favorites").getTotal())
                .isZero();
        assertThat(service.detail(OTHER, "test-0"))
                .containsEntry("favorited", false)
                .containsEntry("favoritedAt", null);
        service.unfavorite(OTHER, "test-0");
        assertThat(service.detail(USER, "test-0")).containsEntry("favorited", true);
        service.unfavorite(USER, "test-0");
        service.unfavorite(USER, "test-0");
        assertThat(service.list(USER, "1", "1", null, null, null, "favorites").getTotal()).isZero();
    }

    @Test
    void paginationFiltersCurrentMetadataAndRetainsUnavailableSnapshot() {
        service.favorite(USER, "test-0");
        service.favorite(USER, "test-1");
        var removed = new LinkedHashMap<>(catalog.detail("test-1"));
        removed.put("id", "removed-style");
        removed.put("name", "已移除长发");
        jdbc.update(
                "INSERT INTO hairstyle_favorite(user_id,hairstyle_id,display_snapshot,created_at,updated_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),UTC_TIMESTAMP(3))",
                USER,
                "removed-style",
                json.writeValueAsString(removed));
        // Current test-0 is SHORT: stale saved LONG must not match the LONG filter.
        jdbc.update(
                "UPDATE hairstyle_favorite SET display_snapshot=JSON_SET(display_snapshot,'$.length','LONG') WHERE user_id=? AND hairstyle_id='test-0'",
                USER);
        var page1 = service.list(USER, "1", "1", "LONG", null, null, "favorites");
        var page2 = service.list(USER, "2", "1", "LONG", null, null, "favorites");
        assertThat(page1.getTotal()).isEqualTo(2);
        assertThat(page1.getItems())
                .singleElement()
                .satisfies(
                        row ->
                                assertThat(row)
                                        .containsEntry("id", "removed-style")
                                        .containsEntry("availability", "UNAVAILABLE")
                                        .containsEntry("name", "已移除长发"));
        assertThat(page2.getItems())
                .singleElement()
                .satisfies(
                        row ->
                                assertThat(row)
                                        .containsEntry("id", "test-1")
                                        .containsEntry("availability", "AVAILABLE"));
        assertThat(service.list(USER, "3", "1", "LONG", null, null, "favorites").getItems())
                .isEmpty();
        assertThat(service.list(USER, "1", "100", null, null, null, "all").getTotal()).isEqualTo(2);
        assertThat(service.detail(USER, "removed-style")).containsEntry("favorited", true);
        assertThatThrownBy(() -> service.detail(OTHER, "removed-style"))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(404));
        assertThatThrownBy(() -> service.favorite(USER, "removed-style"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("HAIRSTYLE_UNAVAILABLE"));
        service.unfavorite(USER, "removed-style");
        assertThat(service.list(USER, "1", "100", "LONG", null, null, "favorites").getTotal())
                .isEqualTo(1);
    }

    @Test
    void emptyMatchingSetAndInvalidParametersDoNotBroadenQuery() {
        service.favorite(USER, "test-0");
        assertThat(service.list(USER, "1", "12", null, "FULL", null, "favorites").getTotal())
                .isZero();
        assertThatThrownBy(() -> service.list(USER, "1", "12", null, null, null, "other"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.list(USER, "0", "12", null, null, null, "favorites"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("VALIDATION_ERROR"));
        assertThatThrownBy(() -> service.favorite(USER, "test-2"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("HAIRSTYLE_UNAVAILABLE"));
        assertThat(service.list(USER, "1", "12", null, null, null, "favorites").getTotal())
                .isEqualTo(1);
    }
}
