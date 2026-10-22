package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.OutfitAiService;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/outfit-ai-jobs")
public class OutfitAiJobController {
    private final OutfitAiService service;

    @GetMapping("/{taskId}")
    public ApiResponse<Map<String, Object>> detail(
            @PathVariable String taskId, HttpServletRequest request) {
        return ApiResponses.ok(service.detail(CurrentUser.id(request), taskId), request);
    }

    @GetMapping("/by-request/{key}")
    public ApiResponse<Map<String, Object>> byKey(
            @PathVariable String key, HttpServletRequest request) {
        return ApiResponses.ok(service.byKey(CurrentUser.id(request), key), request);
    }

    @PostMapping(value = "/{taskId}/retry", consumes = "application/json")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<Map<String, Object>> retry(
            @PathVariable String taskId,
            @RequestHeader("Idempotency-Key") String key,
            HttpServletRequest request)
            throws IOException {
        return ApiResponses.ok(
                service.retry(
                        CurrentUser.id(request),
                        taskId,
                        key,
                        DesignController.generationBody(request)),
                request);
    }
}
