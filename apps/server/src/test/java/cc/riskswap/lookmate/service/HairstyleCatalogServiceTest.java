package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.util.*;
import org.junit.jupiter.api.Test;

class HairstyleCatalogServiceTest {
    private final HairstyleCatalogService catalog = new HairstyleCatalogService("v999");

    @Test
    void publishedCatalogHasFourPagesAndThreeAnglesForEveryStyle() {
        var published = new HairstyleCatalogService();
        var ids = new HashSet<Object>();
        for (int page = 1; page <= 4; page++) {
            var result = published.list(Integer.toString(page), "12", null, null, null);
            assertThat(result.getTotal()).isEqualTo(48);
            assertThat(result.getItems()).hasSize(12);
            for (var style : result.getItems()) {
                assertThat(ids.add(style.get("id"))).isTrue();
                assertThat(style).containsEntry("version", "v2");
                assertThat(GenerationService.list(style.get("images")))
                        .extracting(image -> image.get("angle"))
                        .containsExactly("FRONT", "SIDE", "BACK");
                assertThat(published.references(style)).hasSize(3);
                assertThat(published.referenceBytes(style)).isBetween(1L, 20L * 1024 * 1024);
            }
        }
        assertThat(ids).hasSize(48).contains("cornrows", "classic-bob", "uniform-buzz");
        assertThat(published.list("5", "12", null, null, null).getItems()).isEmpty();
        var longStraight = published.list("1", "100", "LONG", "NONE", "STRAIGHT");
        assertThat(longStraight.getItems())
                .extracting(style -> style.get("id"))
                .contains("long-straight", "high-ponytail", "cornrows")
                .doesNotContain("classic-bob", "long-waves");
    }

    @Test
    void switchingCurrentVersionKeepsHistoricalAssetsAndRejectsStaleSelection() {
        var legacy = new HairstyleCatalogService("v1").detail("classic-bob");
        var published = new HairstyleCatalogService();
        assertThat(published.references(legacy)).hasSize(2);
        assertThat(published.referenceBytes(legacy)).isGreaterThan(0);
        assertThat(published.asset("v1", "classic-bob-front.png"))
                .isEqualTo(published.asset("v2", "classic-bob-front.png"));
        assertThatThrownBy(() -> published.select("classic-bob", "v1"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("HAIRSTYLE_CHANGED"));
    }

    @Test
    void springUsesDefaultVersionAndHonorsExplicitVersionOverride() {
        var runner =
                new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                        .withUserConfiguration(HairstyleCatalogService.class);
        runner.run(
                context ->
                        assertThat(
                                        context.getBean(HairstyleCatalogService.class)
                                                .detail("classic-bob"))
                                .containsEntry("version", "v2"));
        runner.withPropertyValues("lookmate.hairstyles.current-version=v1")
                .run(
                        context ->
                                assertThat(
                                                context.getBean(HairstyleCatalogService.class)
                                                        .detail("classic-bob"))
                                        .containsEntry("version", "v1"));
    }

    @Test
    void filtersAndPaginatesWithoutExposingInactiveStyles() {
        var first = catalog.list("1", "1", null, null, null);
        assertThat(first.getTotal()).isEqualTo(2);
        assertThat(first.getItems()).extracting(row -> row.get("id")).containsExactly("test-0");
        assertThat(catalog.list("2", "1", null, null, null).getItems())
                .extracting(row -> row.get("id"))
                .containsExactly("test-1");
        assertThat(catalog.list("1", "20", "LONG", null, null).getTotal()).isEqualTo(1);
        assertThat(catalog.list("2147483647", "100", null, null, null).getItems()).isEmpty();
    }

    @Test
    void validatesPagingFiltersVersionAndRegisteredPaths() {
        assertThatThrownBy(() -> catalog.list("0", null, null, null, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.list(null, "101", null, null, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.list(null, null, "UNKNOWN", null, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.select("test-0", "v1"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("HAIRSTYLE_CHANGED"));
        assertThatThrownBy(() -> catalog.detail("test-2"))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(404));
        assertThatThrownBy(() -> catalog.asset("../", "front.png"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.asset("v999", "../front.png"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.asset("v999", "missing.png"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void missingCurrentCatalogIsUnavailableRatherThanEmptyOrRemoved() {
        var broken = new HairstyleCatalogService("v987654");
        assertThatThrownBy(() -> broken.currentAvailable("classic-bob"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> {
                            assertThat(e.getCode()).isEqualTo("HAIRSTYLE_CATALOG_UNAVAILABLE");
                            assertThat(e.getStatus()).isEqualTo(503);
                        });
        assertThatThrownBy(() -> catalog.requireAvailable("test-2"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("HAIRSTYLE_UNAVAILABLE"));
    }

    @Test
    void snapshotsKeepRegisteredReferencesAndDetectTampering() {
        var snapshot = catalog.detail("test-0");
        var images = GenerationService.list(snapshot.get("images"));
        assertThat(catalog.references(snapshot)).hasSize(1);
        assertThat(catalog.references(snapshot).getFirst().getBytes())
                .isEqualTo(catalog.asset("v999", "front.png"));
        assertThat(catalog.referenceBytes(snapshot)).isGreaterThan(0);
        images.getFirst().put("sha256", "changed");
        assertThatThrownBy(() -> catalog.references(snapshot)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.referenceBytes(snapshot)).isInstanceOf(ApiException.class);
        assertThat(catalog.references(catalog.detail("test-0"))).hasSize(1);
    }
}
