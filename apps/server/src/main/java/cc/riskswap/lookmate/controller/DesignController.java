package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.GenerationRequestBody;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.RecordsService;
import cc.riskswap.lookmate.service.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/designs")
public class DesignController {
    private final cc.riskswap.lookmate.service.GenerationService generation;
    private final RecordsService records;
    private final cc.riskswap.lookmate.service.DesignLifecycleService lifecycle;
    private final WorkspaceService workspace;

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @PathVariable String id,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        lifecycle.remove(CurrentUser.id(request), id, false);
        return ApiResponses.ok(null, request);
    }

    @PostMapping("/{id}/hide")
    public ApiResponse<Void> hide(
            @PathVariable String id,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {
        noBody(body);
        lifecycle.remove(CurrentUser.id(request), id, true);
        return ApiResponses.ok(null, request);
    }

    private static void noBody(byte[] body) {
        if (body != null && body.length > 0)
            throw new cc.riskswap.lookmate.common.exception.ApiException(
                    400, "VALIDATION_ERROR", "此操作不接受请求正文");
    }

    @GetMapping
    public ApiResponse<PageDto<DesignRecordDto>> designs(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String designType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String scope,
            HttpServletRequest request) {
        return ApiResponses.ok(
                records.designs(CurrentUser.id(request), page, pageSize, designType, status, scope),
                request);
    }

    @GetMapping("/{id}")
    public ApiResponse<DesignDetailDto> detail(
            @PathVariable String id, HttpServletRequest request) {
        return ApiResponses.ok(workspace.detail(CurrentUser.id(request), id), request);
    }

    @PostMapping(value = "/preview", consumes = "application/json")
    public ApiResponse<java.util.Map<String, Object>> preview(HttpServletRequest request)
            throws java.io.IOException {
        return ApiResponses.ok(
                generation.preview(
                        CurrentUser.id(request),
                        GenerationRequestBody.parse(request.getInputStream())),
                request);
    }

    @PostMapping(consumes = "application/json")
    @ResponseStatus(org.springframework.http.HttpStatus.ACCEPTED)
    public ApiResponse<java.util.Map<String, Object>> submit(
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request)
            throws java.io.IOException {
        return ApiResponses.ok(
                generation.submit(
                        CurrentUser.id(request),
                        key,
                        GenerationRequestBody.parse(request.getInputStream())),
                request);
    }

    @GetMapping("/by-request/{key}")
    public ApiResponse<java.util.Map<String, Object>> byKey(
            @PathVariable String key, HttpServletRequest request) {
        return ApiResponses.ok(generation.byKey(CurrentUser.id(request), key), request);
    }

    @PostMapping(value = "/{id}/retry", consumes = "application/json")
    @ResponseStatus(org.springframework.http.HttpStatus.ACCEPTED)
    public ApiResponse<java.util.Map<String, Object>> retry(
            @PathVariable String id,
            @RequestHeader("Idempotency-Key") String key,
            HttpServletRequest request)
            throws java.io.IOException {
        return ApiResponses.ok(
                generation.retry(
                        CurrentUser.id(request),
                        id,
                        key,
                        GenerationRequestBody.parse(request.getInputStream())),
                request);
    }
}
