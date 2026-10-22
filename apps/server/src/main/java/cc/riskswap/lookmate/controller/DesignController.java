package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.model.dto.*;
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
    private final WorkspaceService workspace;

    @GetMapping
    public ApiResponse<PageDto<TaskSummaryDto>> designs(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String designType,
            @RequestParam(required = false) String status,
            HttpServletRequest request) {
        return ApiResponses.ok(
                records.designs(CurrentUser.id(request), page, pageSize, designType, status),
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
                generation.preview(CurrentUser.id(request), generationBody(request)), request);
    }

    @PostMapping(consumes = "application/json")
    @ResponseStatus(org.springframework.http.HttpStatus.ACCEPTED)
    public ApiResponse<java.util.Map<String, Object>> submit(
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request)
            throws java.io.IOException {
        return ApiResponses.ok(
                generation.submit(CurrentUser.id(request), key, generationBody(request)), request);
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
                generation.retry(CurrentUser.id(request), id, key, generationBody(request)),
                request);
    }

    static java.util.Map<String, Object> generationBody(HttpServletRequest request)
            throws java.io.IOException {
        byte[] bytes = request.getInputStream().readNBytes(32769);
        if (bytes.length > 32768)
            throw new cc.riskswap.lookmate.common.exception.ApiException(
                    413, "REQUEST_TOO_LARGE", "设计请求超过大小限制");
        try {
            var factory =
                    tools.jackson.core.json.JsonFactory.builder()
                            .enable(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                            .build();
            var mapper =
                    tools.jackson.databind.json.JsonMapper.builder(factory)
                            .enable(
                                    tools.jackson.databind.DeserializationFeature
                                            .FAIL_ON_TRAILING_TOKENS)
                            .build();
            Object value = mapper.readValue(bytes, Object.class);
            if (!(value instanceof java.util.Map<?, ?>)) throw new IllegalArgumentException();
            return (java.util.Map<String, Object>) value;
        } catch (RuntimeException e) {
            throw new cc.riskswap.lookmate.common.exception.ApiException(
                    400, "VALIDATION_ERROR", "设计请求JSON不合法");
        }
    }
}
