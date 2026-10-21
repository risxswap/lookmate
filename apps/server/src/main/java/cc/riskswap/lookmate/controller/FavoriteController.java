package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.RecordsService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/favorites")
public class FavoriteController {
    private final RecordsService records;

    @GetMapping
    public ApiResponse<PageDto<FavoriteDto>> favorites(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String collectionId,
            HttpServletRequest request) {
        return ApiResponses.ok(
                records.favorites(CurrentUser.id(request), page, pageSize, collectionId), request);
    }

    @PutMapping("/{resultId}")
    public ApiResponse<FavoriteDto> favorite(
            @PathVariable String resultId,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        return ApiResponses.ok(records.favorite(CurrentUser.id(request), resultId), request);
    }

    @DeleteMapping("/{resultId}")
    public ApiResponse<Void> unfavorite(
            @PathVariable String resultId,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        records.unfavorite(CurrentUser.id(request), resultId);
        return ApiResponses.ok(null, request);
    }

    private static void noBody(byte[] body) {
        if (body != null && body.length > 0)
            throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求正文");
    }
}
