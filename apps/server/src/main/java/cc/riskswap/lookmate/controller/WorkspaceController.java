package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiResponse;
import cc.riskswap.lookmate.dto.WorkspaceDto;
import cc.riskswap.lookmate.security.CurrentUser;
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
        return new ApiResponse<>(
                workspace.workspace(CurrentUser.id(request)),
                (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
