package cc.riskswap.lookmate.controller;

import jakarta.servlet.http.HttpServletRequest;
import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiResponse;
import cc.riskswap.lookmate.dto.AccountDto;
import cc.riskswap.lookmate.dto.WorkspaceDto;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class WorkspaceController {
    private final WorkspaceService workspace;

    @GetMapping("/api/workspace")
    public ApiResponse<WorkspaceDto> workspace(HttpServletRequest request) {
        var account = (AccountDto) request.getAttribute(AuthGuardFilter.ACCOUNT);
        return new ApiResponse<>(workspace.workspace(Long.valueOf(account.getId())),
                (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
