package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.HairstyleCatalogService;
import cc.riskswap.lookmate.service.HairstyleFavoriteService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/hairstyles")
public class HairstyleController {
    private final HairstyleCatalogService catalog;
    private final HairstyleFavoriteService favorites;

    @GetMapping
    public ApiResponse<PageDto<Map<String, Object>>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String length,
            @RequestParam(required = false) String bangs,
            @RequestParam(required = false) String texture,
            @RequestParam(required = false) String scope,
            HttpServletRequest request) {
        return ApiResponses.ok(
                favorites.list(
                        CurrentUser.id(request), page, pageSize, length, bangs, texture, scope),
                request);
    }

    @GetMapping("/{id}")
    public ApiResponse<Map<String, Object>> detail(
            @PathVariable String id, HttpServletRequest request) {
        return ApiResponses.ok(favorites.detail(CurrentUser.id(request), id), request);
    }

    @PutMapping("/{id}/favorite")
    public ResponseEntity<ApiResponse<Map<String, Object>>> favorite(
            @PathVariable String id,
            @RequestBody(required = false) String body,
            HttpServletRequest request) {
        rejectBody(body);
        var result = favorites.favorite(CurrentUser.id(request), id);
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(ApiResponses.ok(result.data(), request));
    }

    @DeleteMapping("/{id}/favorite")
    public ApiResponse<Void> unfavorite(
            @PathVariable String id,
            @RequestBody(required = false) String body,
            HttpServletRequest request) {
        rejectBody(body);
        favorites.unfavorite(CurrentUser.id(request), id);
        return ApiResponses.ok(null, request);
    }

    private void rejectBody(String body) {
        if (body != null && !body.isBlank())
            throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求字段");
    }

    @GetMapping("/assets/{version}/{filename}")
    public ResponseEntity<byte[]> asset(
            @PathVariable String version,
            @PathVariable String filename,
            HttpServletRequest request) {
        CurrentUser.id(request);
        byte[] bytes = catalog.asset(version, filename);
        String mime =
                filename.endsWith(".png")
                        ? "image/png"
                        : filename.endsWith(".webp") ? "image/webp" : "image/jpeg";
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(mime))
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(bytes);
    }
}
