package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.model.dto.PageDto;
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
@RequestMapping("/api/outfits/{outfitId}/ai-jobs")
public class OutfitAiController {
    private final OutfitAiService service;

    @PostMapping(consumes = "application/json")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<Map<String, Object>> submit(
            @PathVariable String outfitId,
            @RequestHeader("Idempotency-Key") String key,
            HttpServletRequest request)
            throws IOException {
        return ApiResponses.ok(
                service.submit(
                        CurrentUser.id(request),
                        outfitId,
                        key,
                        DesignController.generationBody(request)),
                request);
    }

    @GetMapping
    public ApiResponse<PageDto<Map<String, Object>>> list(
            @PathVariable String outfitId,
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            HttpServletRequest request) {
        return ApiResponses.ok(
                service.list(CurrentUser.id(request), outfitId, page, pageSize), request);
    }
}
