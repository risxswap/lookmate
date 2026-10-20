package cc.riskswap.lookmate.controller;

import jakarta.servlet.http.HttpServletRequest;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiResponse;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.param.CollectionCreateParam;
import cc.riskswap.lookmate.param.CollectionRenameParam;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.RecordsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
public class RecordsController {
    private final RecordsService records;

    @GetMapping("/api/designs")
    public ApiResponse<PageDto<TaskSummaryDto>> designs(@RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize, @RequestParam(required = false) String designType,
            @RequestParam(required = false) String status, HttpServletRequest request) {
        return response(records.designs(user(request), page, pageSize, designType, status), request);
    }

    @GetMapping("/api/favorites")
    public ApiResponse<PageDto<FavoriteDto>> favorites(@RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize, @RequestParam(required = false) String collectionId,
            HttpServletRequest request) {
        return response(records.favorites(user(request), page, pageSize, collectionId), request);
    }

    @GetMapping("/api/collections")
    public ApiResponse<PageDto<CollectionDto>> collections(@RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize, HttpServletRequest request) {
        return response(records.collections(user(request), page, pageSize), request);
    }

    @GetMapping("/api/collections/{id}")
    public ApiResponse<CollectionDto> collection(@PathVariable String id, HttpServletRequest request) {
        return response(records.collection(user(request), id), request);
    }

    @PutMapping("/api/favorites/{resultId}")
    public ApiResponse<FavoriteDto> favorite(@PathVariable String resultId, @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        return response(records.favorite(user(request), resultId), request);
    }

    @DeleteMapping("/api/favorites/{resultId}")
    public ApiResponse<Void> unfavorite(@PathVariable String resultId, @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        records.unfavorite(user(request), resultId);
        return response(null, request);
    }

    @PostMapping("/api/collections")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CollectionDto> create(@RequestBody CollectionCreateParam body, HttpServletRequest request) {
        return response(records.createCollection(user(request), body.getName()), request);
    }

    @PatchMapping("/api/collections/{id}")
    public ApiResponse<CollectionDto> rename(@PathVariable String id, @RequestBody CollectionRenameParam body,
            HttpServletRequest request) {
        return response(records.renameCollection(user(request), id, body.getName(), body.getVersion()), request);
    }

    @DeleteMapping("/api/collections/{id}")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        records.deleteCollection(user(request), id);
        return response(null, request);
    }

    @PutMapping("/api/collections/{id}/items/{favoriteId}")
    public ApiResponse<Void> add(@PathVariable String id, @PathVariable String favoriteId,
            @RequestBody(required = false) byte[] body, HttpServletRequest request) {
        noBody(body);
        records.membership(user(request), id, favoriteId, true);
        return response(null, request);
    }

    @DeleteMapping("/api/collections/{id}/items/{favoriteId}")
    public ApiResponse<Void> remove(@PathVariable String id, @PathVariable String favoriteId,
            @RequestBody(required = false) byte[] body, HttpServletRequest request) {
        noBody(body);
        records.membership(user(request), id, favoriteId, false);
        return response(null, request);
    }

    private static void noBody(byte[] body) {
        if (body != null && body.length > 0) throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求正文");
    }
    private static Long user(HttpServletRequest request) {
        return Long.valueOf(((AccountDto) request.getAttribute(AuthGuardFilter.ACCOUNT)).getId());
    }
    private static <T> ApiResponse<T> response(T data, HttpServletRequest request) {
        return new ApiResponse<>(data, (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
