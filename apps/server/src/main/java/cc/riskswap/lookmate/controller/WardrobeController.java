package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.advice.*;
import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.exception.*;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.WardrobeService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/dresses")
public class WardrobeController {
    private final WardrobeService wardrobe;

    @GetMapping("/categories")
    public ApiResponse<List<DressCategoryDto>> categories(HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.categories(), r);
    }

    @GetMapping
    public ApiResponse<PageDto<DressDto>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String categoryId,
            HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.list(CurrentUser.id(r), page, pageSize, categoryId), r);
    }

    @GetMapping("/{id}")
    public ApiResponse<DressDto> detail(@PathVariable String id, HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.detail(CurrentUser.id(r), id), r);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<DressDto> create(
            @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.create(CurrentUser.id(r), body), r);
    }

    @PatchMapping("/{id}")
    public ApiResponse<DressDto> patch(
            @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.patch(CurrentUser.id(r), id, body), r);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @PathVariable String id,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest r) {
        if (body != null && body.length > 0)
            throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求正文");
        wardrobe.delete(CurrentUser.id(r), id);
        return ApiResponses.ok(null, r);
    }

    @PatchMapping("/{id}/images/{imageId}")
    public ApiResponse<DressDto> manual(
            @PathVariable String id,
            @PathVariable String imageId,
            @RequestBody Map<String, Object> body,
            HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.manual(CurrentUser.id(r), id, imageId, body), r);
    }

    @PostMapping("/{id}/recognition-retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<DressRecognitionDto> retry(
            @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(wardrobe.retry(CurrentUser.id(r), id, body), r);
    }
}
