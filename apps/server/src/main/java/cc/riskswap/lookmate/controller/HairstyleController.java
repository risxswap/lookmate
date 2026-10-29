package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.HairstyleCatalogService;
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

    @GetMapping
    public ApiResponse<PageDto<Map<String, Object>>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String length,
            @RequestParam(required = false) String bangs,
            @RequestParam(required = false) String texture,
            HttpServletRequest request) {
        CurrentUser.id(request);
        return ApiResponses.ok(catalog.list(page, pageSize, length, bangs, texture), request);
    }

    @GetMapping("/{id}")
    public ApiResponse<Map<String, Object>> detail(
            @PathVariable String id, HttpServletRequest request) {
        CurrentUser.id(request);
        return ApiResponses.ok(catalog.detail(id), request);
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
