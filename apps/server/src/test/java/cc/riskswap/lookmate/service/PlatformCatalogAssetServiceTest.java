package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

class PlatformCatalogAssetServiceTest {
    private final HairstyleCatalogService hairstyles = new HairstyleCatalogService();
    private final OutfitInspirationCatalogService inspirations =
            mock(OutfitInspirationCatalogService.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final AssetProperties properties = new AssetProperties();
    private final PlatformCatalogAssetService assets =
            new PlatformCatalogAssetService(hairstyles, inspirations, storage, properties);

    @Test
    void registeredHairUsesImmutableObjectAndRequestedImageSize() throws Exception {
        when(storage.available()).thenReturn(true);
        when(storage.bucket()).thenReturn("private");
        var original = hairstyles.asset("v1", "textured-crop-front.png");
        var hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original));
        var key = "platform-catalog/hairstyles/v1/" + hash + "/textured-crop-front.png";
        when(storage.imageUrl("private", key, 300, 480, 640, 80))
                .thenReturn("https://private.example/thumb");
        var thumbnail = assets.access("hairstyles", "v1", "textured-crop-front.png", "THUMBNAIL");
        assertThat(thumbnail.get("url")).isEqualTo("https://private.example/thumb");
        assertThat((Instant) thumbnail.get("expiresAt"))
                .isBetween(Instant.now().plusSeconds(295), Instant.now().plusSeconds(305));
        when(storage.imageUrl("private", key, 300, 1280, 1280, 85))
                .thenReturn("https://private.example/display");
        assertThat(
                        assets.access("hairstyles", "v1", "textured-crop-front.png", "DISPLAY")
                                .get("url"))
                .isEqualTo("https://private.example/display");
        assertThat(hairstyles.asset("v1", "textured-crop-front.png")).isEqualTo(original);
    }

    @Test
    void invalidVariantsAndUnknownResourcesAreRejectedBeforeSigning() {
        for (String variant : new String[] {null, "", "ORIGINAL", "invalid"}) {
            assertThatThrownBy(
                            () ->
                                    assets.access(
                                            "hairstyles", "v1", "textured-crop-front.png", variant))
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            error -> assertThat(error.getStatus()).isEqualTo(400));
        }
        assertThatThrownBy(() -> assets.access("hairstyles", "v1", "missing.png", "THUMBNAIL"))
                .isInstanceOfSatisfying(
                        ApiException.class, error -> assertThat(error.getStatus()).isEqualTo(404));
        assertThatThrownBy(
                        () ->
                                assets.access(
                                        "hairstyles",
                                        "../v1",
                                        "textured-crop-front.png",
                                        "THUMBNAIL"))
                .isInstanceOfSatisfying(
                        ApiException.class, error -> assertThat(error.getStatus()).isEqualTo(404));
        verifyNoInteractions(storage);
    }

    @Test
    void unavailableStorageAndMaintenanceFailWithoutSigning() {
        assertThatThrownBy(
                        () ->
                                assets.access(
                                        "hairstyles", "v1", "textured-crop-front.png", "THUMBNAIL"))
                .isInstanceOfSatisfying(
                        ApiException.class, error -> assertThat(error.getStatus()).isEqualTo(503));
        when(storage.available()).thenReturn(true);
        properties.setMaintenance(true);
        assertThatThrownBy(
                        () ->
                                assets.access(
                                        "hairstyles", "v1", "textured-crop-front.png", "THUMBNAIL"))
                .isInstanceOfSatisfying(
                        ApiException.class, error -> assertThat(error.getStatus()).isEqualTo(503));
        verify(storage, never()).imageUrl(any(), any(), anyLong(), anyInt(), anyInt(), anyInt());
    }

    @Test
    void outfitAccessUsesTheSameObjectKeyAndClampsExpiration() {
        when(inspirations.asset("v1", "outfit.png")).thenReturn(new byte[] {1, 2, 3});
        when(storage.available()).thenReturn(true);
        when(storage.bucket()).thenReturn("private");
        properties.setAccessSeconds(5000);
        when(storage.imageUrl(
                        eq("private"),
                        startsWith("platform-catalog/outfit-inspirations/v1/"),
                        eq(900L),
                        eq(480),
                        eq(640),
                        eq(80)))
                .thenReturn("https://private.example/outfit");
        assertThat(assets.access("outfit-inspirations", "v1", "outfit.png", "THUMBNAIL").get("url"))
                .isEqualTo("https://private.example/outfit");
    }
}
