package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.CollectionCreateParam;
import cc.riskswap.lookmate.common.model.param.CollectionRenameParam;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.RecordsService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/collections")
public class CollectionController {
    private final RecordsService records;

    @GetMapping
    public ApiResponse<PageDto<CollectionDto>> collections(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            HttpServletRequest request) {
        return ApiResponses.ok(
                records.collections(CurrentUser.id(request), page, pageSize), request);
    }

    @GetMapping("/{id}")
    public ApiResponse<CollectionDto> collection(
            @PathVariable String id, HttpServletRequest request) {
        return ApiResponses.ok(records.collection(CurrentUser.id(request), id), request);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CollectionDto> create(
            @RequestBody CollectionCreateParam body, HttpServletRequest request) {
        return ApiResponses.ok(
                records.createCollection(CurrentUser.id(request), body.getName()), request);
    }

    @PatchMapping("/{id}")
    public ApiResponse<CollectionDto> rename(
            @PathVariable String id,
            @RequestBody CollectionRenameParam body,
            HttpServletRequest request) {
        return ApiResponses.ok(
                records.renameCollection(
                        CurrentUser.id(request), id, body.getName(), body.getVersion()),
                request);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @PathVariable String id,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        records.deleteCollection(CurrentUser.id(request), id);
        return ApiResponses.ok(null, request);
    }

    @PutMapping("/{id}/items/{favoriteId}")
    public ApiResponse<Void> add(
            @PathVariable String id,
            @PathVariable String favoriteId,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        records.membership(CurrentUser.id(request), id, favoriteId, true);
        return ApiResponses.ok(null, request);
    }

    @DeleteMapping("/{id}/items/{favoriteId}")
    public ApiResponse<Void> remove(
            @PathVariable String id,
            @PathVariable String favoriteId,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        records.membership(CurrentUser.id(request), id, favoriteId, false);
        return ApiResponses.ok(null, request);
    }

    private static void noBody(byte[] body) {
        if (body != null && body.length > 0)
            throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求正文");
    }
}
