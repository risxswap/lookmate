package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiResponse;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.security.CurrentUser;
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
        return response(
                records.designs(CurrentUser.id(request), page, pageSize, designType, status),
                request);
    }

    @GetMapping("/{id}")
    public ApiResponse<DesignDetailDto> detail(
            @PathVariable String id, HttpServletRequest request) {
        return new ApiResponse<>(
                workspace.detail(CurrentUser.id(request), id),
                (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }

    private static <T> ApiResponse<T> response(T data, HttpServletRequest request) {
        return new ApiResponse<>(data, (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
