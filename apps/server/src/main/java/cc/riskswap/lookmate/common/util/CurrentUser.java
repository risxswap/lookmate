package cc.riskswap.lookmate.common.util;

import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import jakarta.servlet.http.HttpServletRequest;

/** 读取 AuthGuardFilter 已校验并写入当前请求的账号信息。 */
public final class CurrentUser {
    private CurrentUser() {}

    public static AccountDto account(HttpServletRequest request) {
        return (AccountDto) request.getAttribute(AuthGuardFilter.ACCOUNT);
    }

    public static Long id(HttpServletRequest request) {
        return Long.valueOf(account(request).getId());
    }
}
