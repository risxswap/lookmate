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
@RequestMapping("/api/outfit-groups")
public class OutfitGroupController {
    private final OutfitService service;

    @GetMapping
    public ApiResponse<PageDto<OutfitGroupDto>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            HttpServletRequest r) {
        return ApiResponses.ok(service.groups(CurrentUser.id(r), page, pageSize), r);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OutfitGroupDto> create(
            @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.createGroup(CurrentUser.id(r), body), r);
    }

    @PatchMapping("/{id}")
    public ApiResponse<OutfitGroupDto> patch(
            @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest r) {
        return ApiResponses.ok(service.patchGroup(CurrentUser.id(r), id, body), r);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @PathVariable String id,
            @RequestParam String version,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest r) {
        if (body != null && body.length > 0) throw OutfitParameters.invalid();
        service.deleteGroup(CurrentUser.id(r), id, version);
        return ApiResponses.ok(null, r);
    }
}
