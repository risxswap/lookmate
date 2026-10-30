package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.*;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.*;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth/wechat")
@RequiredArgsConstructor
public class WechatAuthController {
    private final WechatAuthService service;
    private final AuthRateLimiter limits;

    @PostMapping("/login")
    public ApiResponse<?> login(@RequestBody String body, HttpServletRequest r) {
        limits.request(r.getRemoteAddr(), false);
        var p = WechatParameters.parse(body, "code");
        return ApiResponses.ok(service.login(WechatParameters.text(p, "code", 256)), r);
    }

    @PostMapping("/register")
    public ApiResponse<?> register(@RequestBody String body, HttpServletRequest r) {
        limits.request(r.getRemoteAddr(), true);
        var p = WechatParameters.parse(body, "ticket");
        return ApiResponses.ok(service.register(WechatParameters.text(p, "ticket", 32)), r);
    }

    @PostMapping("/bind")
    public ApiResponse<?> bind(@RequestBody String body, HttpServletRequest r) {
        limits.request(r.getRemoteAddr(), false);
        var p = WechatParameters.parse(body, "ticket", "username", "password");
        var c = new CredentialsParam();
        String name = WechatParameters.text(p, "username", 32);
        if (!name.matches("[A-Za-z0-9_]{4,32}"))
            throw new ApiException(400, "VALIDATION_ERROR", "用户名格式不正确");
        c.setUsername(name);
        c.setPassword(WechatParameters.password(p));
        return ApiResponses.ok(
                service.bind(WechatParameters.text(p, "ticket", 32), c, r.getRemoteAddr()), r);
    }

    @GetMapping("/qr/{id}")
    public ApiResponse<?> qr(@PathVariable String id, HttpServletRequest r) {
        mini(r);
        return ApiResponses.ok(service.qrStatus(id, null), r);
    }

    @PostMapping("/qr/{id}/confirm")
    public ApiResponse<?> confirm(
            @PathVariable String id, @RequestBody String body, HttpServletRequest r) {
        mini(r);
        WechatParameters.empty(body);
        return ApiResponses.ok(service.decide(id, CurrentUser.id(r), true), r);
    }

    @PostMapping("/qr/{id}/cancel")
    public ApiResponse<?> cancel(
            @PathVariable String id, @RequestBody String body, HttpServletRequest r) {
        mini(r);
        WechatParameters.empty(body);
        return ApiResponses.ok(service.decide(id, CurrentUser.id(r), false), r);
    }

    private void mini(HttpServletRequest r) {
        if (!Boolean.TRUE.equals(r.getAttribute(MiniappSessionService.VERIFIED)))
            throw new ApiException(403, "FORBIDDEN", "请在小程序中确认登录");
    }
}
