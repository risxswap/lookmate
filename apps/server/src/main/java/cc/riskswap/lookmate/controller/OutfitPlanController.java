package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.OutfitPlanParameters;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.OutfitPlanService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/outfit-plans")
public class OutfitPlanController {
    private final OutfitPlanService service;

    @GetMapping
    public ApiResponse<PageDto<OutfitPlanDto>> list(
            @RequestParam String date,
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            HttpServletRequest r) {
        return ApiResponses.ok(service.list(CurrentUser.id(r), date, page, pageSize), r);
    }

    @GetMapping("/calendar")
    public ApiResponse<Map<String, Object>> calendar(
            @RequestParam String from, @RequestParam String to, HttpServletRequest r) {
        return ApiResponses.ok(service.calendar(CurrentUser.id(r), from, to), r);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OutfitPlanDto> create(
            @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.create(CurrentUser.id(r), body), r);
    }

    @PatchMapping("/{id}")
    public ApiResponse<OutfitPlanDto> patch(
            @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.patch(CurrentUser.id(r), id, body), r);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @PathVariable String id,
            @RequestParam String version,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest r) {
        if (body != null && body.length > 0) throw OutfitPlanParameters.invalid();
        service.delete(CurrentUser.id(r), id, version);
        return ApiResponses.ok(null, r);
    }
}
