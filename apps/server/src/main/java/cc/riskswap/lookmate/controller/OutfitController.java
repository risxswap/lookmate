package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.OutfitParameters;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.OutfitService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/outfits")
public class OutfitController {
    private final OutfitService service;

    @GetMapping
    public ApiResponse<PageDto<OutfitDto>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String groupId,
            @RequestParam(required = false) String scene,
            HttpServletRequest r) {
        return ApiResponses.ok(service.list(CurrentUser.id(r), page, pageSize, groupId, scene), r);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OutfitDto> create(
            @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.create(CurrentUser.id(r), body), r);
    }

    @PatchMapping("/{id}")
    public ApiResponse<OutfitDto> patch(
            @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.patch(CurrentUser.id(r), id, body), r);
    }

    @PutMapping("/{id}/scenes")
    public ApiResponse<OutfitDto> scenes(
            @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.setScenes(CurrentUser.id(r), id, body), r);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @PathVariable String id,
            @RequestParam String version,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest r) {
        if (body != null && body.length > 0) throw OutfitParameters.invalid();
        service.delete(CurrentUser.id(r), id, version);
        return ApiResponses.ok(null, r);
    }

    @GetMapping("/{id}")
    public ApiResponse<OutfitDto> detail(@PathVariable String id, HttpServletRequest r) {
        return ApiResponses.ok(service.detail(CurrentUser.id(r), id), r);
    }

    @PostMapping("/from-design/{taskId}")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OutfitDto> fromDesign(
            @PathVariable String taskId,
            @RequestBody Map<String, Object> body,
            HttpServletRequest r) {
        return ApiResponses.ok(service.fromDesign(CurrentUser.id(r), taskId, body), r);
    }
}
