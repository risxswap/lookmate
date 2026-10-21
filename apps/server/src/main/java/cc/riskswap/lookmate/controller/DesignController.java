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
}
