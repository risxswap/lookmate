package cc.riskswap.lookmate.controller;

import jakarta.servlet.http.HttpServletRequest;
import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiResponse;
import cc.riskswap.lookmate.dto.AccountDto;
import cc.riskswap.lookmate.dto.DesignDetailDto;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PathVariable;

@RestController
@RequiredArgsConstructor
public class DesignQueryController {
    private final WorkspaceService workspace;

    @GetMapping("/api/designs/{id}")
    public ApiResponse<DesignDetailDto> detail(@PathVariable String id, HttpServletRequest request) {
        var account = (AccountDto) request.getAttribute(AuthGuardFilter.ACCOUNT);
        return new ApiResponse<>(workspace.detail(Long.valueOf(account.getId()), id),
                (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
