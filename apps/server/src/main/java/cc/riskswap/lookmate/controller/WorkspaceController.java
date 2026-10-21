package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.ApiResponse;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.model.dto.WorkspaceDto;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class WorkspaceController {
    private final WorkspaceService workspace;

    @GetMapping("/api/workspace")
    public ApiResponse<WorkspaceDto> workspace(HttpServletRequest request) {
        return ApiResponses.ok(workspace.workspace(CurrentUser.id(request)), request);
    }
}
