package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.util.*;
import org.junit.jupiter.api.Test;

class OutfitInspirationCatalogServiceTest {
    @Test
    void duplicateIdentityMissingFileAndDigestMismatchFailClosed() {
        for (String version : List.of("v996", "v997", "v998")) {
            var catalog = new OutfitInspirationCatalogService(version);
            assertThatCode(catalog::validateCurrentCatalog).doesNotThrowAnyException();
            assertThatThrownBy(() -> catalog.list("1", "12", null, null))
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            e ->
                                    assertThat(e.getCode())
                                            .isEqualTo("OUTFIT_INSPIRATION_CATALOG_UNAVAILABLE"));
        }
    }

    @Test
    void publishedCatalogHasTwentyFourVerifiedImagesAndSafeProjection() {
        var catalog = new OutfitInspirationCatalogService();
        var rows = catalog.list("1", "100", null, null);
        assertThat(rows.getTotal()).isEqualTo(24);
        for (var row : rows.getItems()) {
            assertThat(catalog.references(row)).hasSize(1);
            assertThat(catalog.referenceBytes(row)).isBetween(1L, 5L * 1024 * 1024);
            assertThat(
                            GenerationService.map(
                                    OutfitInspirationCatalogService.safeReference(row)
                                            .get("image")))
                    .containsOnlyKeys("id", "url", "width", "height");
        }
        assertThat(catalog.list("3", "12", null, null).getItems()).isEmpty();
        assertThat(catalog.list("1", "100", null, "MINIMAL").getItems()).hasSize(4);
    }

    @Test
    void invalidDirectoryDoesNotPreventApplicationStartupAndSelectionIsStrict() {
        var broken = new OutfitInspirationCatalogService("v888");
        assertThatCode(broken::validateCurrentCatalog).doesNotThrowAnyException();
        assertThatThrownBy(() -> broken.list(null, null, null, null))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(503));
        var catalog = new OutfitInspirationCatalogService("v999");
        assertThatThrownBy(() -> catalog.select("test-0", "v1"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("OUTFIT_INSPIRATION_CHANGED"));
        assertThatThrownBy(() -> catalog.list("1", "101", null, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> catalog.list("1", "12", "", null))
                .isInstanceOf(ApiException.class);
        var snapshot = catalog.requireAvailable("test-0");
        GenerationService.map(snapshot.get("image")).put("sha256", "bad");
        assertThatThrownBy(() -> catalog.references(snapshot))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("OUTFIT_INSPIRATION_ASSET_INVALID"));
        assertThat(catalog.hasAsset("v999", "../catalog.json")).isFalse();
    }
}
