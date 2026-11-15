package cc.riskswap.lookmate.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cc.riskswap.lookmate.common.api.ApiErrors;
import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.service.*;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PlatformCatalogAssetControllerTest {
    @Test
    void bothCataloguesExposeWrappedSignedUrlsAndDefaultThumbnailVariant() throws Exception {
        var assets = mock(PlatformCatalogAssetService.class);
        var response =
                Map.<String, Object>of(
                        "url",
                        "https://private.example/image?imageView2/2/w/480/h/640",
                        "expiresAt",
                        Instant.parse("2026-11-14T00:05:00Z"));
        when(assets.access("hairstyles", "v1", "front.png", "THUMBNAIL")).thenReturn(response);
        when(assets.access("outfit-inspirations", "v1", "outfit.png", "DISPLAY"))
                .thenReturn(response);
        var mvc =
                MockMvcBuilders.standaloneSetup(
                                new HairstyleController(
                                        mock(HairstyleCatalogService.class),
                                        mock(HairstyleFavoriteService.class),
                                        assets),
                                new OutfitInspirationController(
                                        mock(OutfitInspirationCatalogService.class),
                                        mock(OutfitInspirationFavoriteService.class),
                                        assets))
                        .build();
        mvc.perform(
                        get("/api/hairstyles/assets/v1/front.png/access")
                                .requestAttr(
                                        AuthGuardFilter.ACCOUNT, new AccountDto("7", "user", null))
                                .requestAttr(ApiErrors.REQUEST_ID, "catalog-request"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").value(response.get("url")))
                .andExpect(jsonPath("$.data.expiresAt").value("2026-11-14T00:05:00Z"))
                .andExpect(jsonPath("$.requestId").value("catalog-request"));
        mvc.perform(
                        get("/api/outfit-inspirations/assets/v1/outfit.png/access")
                                .param("variant", "DISPLAY")
                                .requestAttr(
                                        AuthGuardFilter.ACCOUNT, new AccountDto("7", "user", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").value(response.get("url")));
        verify(assets).access("hairstyles", "v1", "front.png", "THUMBNAIL");
        verify(assets).access("outfit-inspirations", "v1", "outfit.png", "DISPLAY");
    }
}
