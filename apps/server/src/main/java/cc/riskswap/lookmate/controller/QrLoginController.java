package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.WechatParameters;
import cc.riskswap.lookmate.service.*;
import jakarta.servlet.http.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth/qr")
@RequiredArgsConstructor
public class QrLoginController {
    private final WechatAuthService service;
    private final WebLoginService login;
    private final AuthRateLimiter limits;

    @PostMapping
    public ApiResponse<?> create(@RequestBody String body, HttpServletRequest r) {
        browser(r);
        WechatParameters.empty(body);
        limits.request(r.getRemoteAddr(), false);
        return ApiResponses.ok(service.createQr(r.getSession().getId()), r);
    }

    @GetMapping("/{id}")
    public ApiResponse<?> status(@PathVariable String id, HttpServletRequest r) {
        return ApiResponses.ok(service.qrStatus(id, owner(r)), r);
    }

    @PostMapping("/{id}/claim")
    public ApiResponse<?> claim(
            @PathVariable String id,
            @RequestBody String body,
            HttpServletRequest r,
            HttpServletResponse response) {
        WechatParameters.empty(body);
        var user = service.claim(id, owner(r));
        return ApiResponses.ok(login.login(user, r, response), r);
    }

    private String owner(HttpServletRequest r) {
        browser(r);
        var s = r.getSession(false);
        if (s == null) throw new ApiException(404, "NOT_FOUND", "登录请求不存在");
        return s.getId();
    }

    private void browser(HttpServletRequest r) {
        if (r.getHeader(MiniappSessionService.HEADER) != null)
            throw new ApiException(403, "FORBIDDEN", "请在原浏览器操作");
    }
}
