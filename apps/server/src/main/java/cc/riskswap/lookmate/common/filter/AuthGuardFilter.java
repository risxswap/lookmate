package cc.riskswap.lookmate.common.filter;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.service.AuthRateLimiter;
import cc.riskswap.lookmate.service.AuthService;
import cc.riskswap.lookmate.service.MiniappSessionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

@RequiredArgsConstructor
public class AuthGuardFilter extends OncePerRequestFilter {
    public static final String REMEMBER_ME = "lookmate.rememberMe";
    public static final String LOGIN_AT = "lookmate.loginAt";
    public static final String PASSWORD_FINGERPRINT = "lookmate.passwordFingerprint";
    public static final String ACCOUNT = "lookmate.account";
    private final AuthService auth;
    private final AuthRateLimiter limits;
    private final AuthProperties properties;
    private final Clock clock;
    private MiniappSessionService miniapp;

    public AuthGuardFilter withMiniapp(MiniappSessionService value) {
        this.miniapp = value;
        return this;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getServletPath();
        String miniToken = request.getHeader(MiniappSessionService.HEADER);
        if (miniToken != null) {
            if (miniapp == null) throw new ApiException(401, "UNAUTHENTICATED", "登录已失效");
            var account = miniapp.validate(miniToken);
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(
                    UsernamePasswordAuthenticationToken.authenticated(
                            account.getId(),
                            null,
                            List.of(new SimpleGrantedAuthority("ROLE_USER"))));
            SecurityContextHolder.setContext(context);
            request.setAttribute(ACCOUNT, account);
            request.setAttribute(MiniappSessionService.VERIFIED, true);
            if ("POST".equals(request.getMethod()) && "/api/auth/password".equals(path))
                limits.passwordRequest(request.getRemoteAddr());
            String override = request.getHeader("X-HTTP-Method-Override");
            if (override != null) {
                if (!"POST".equals(request.getMethod()) || !"PATCH".equals(override))
                    throw new ApiException(400, "VALIDATION_ERROR", "不支持该请求方法覆盖");
                chain.doFilter(
                        new jakarta.servlet.http.HttpServletRequestWrapper(request) {
                            @Override
                            public String getMethod() {
                                return "PATCH";
                            }
                        },
                        response);
            } else chain.doFilter(request, response);
            return;
        }

        if ("POST".equals(request.getMethod())
                && ("/api/auth/login".equals(path) || "/api/auth/register".equals(path))) {
            limits.request(request.getRemoteAddr(), path.endsWith("/register"));
        }
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            var session = request.getSession(false);
            Object loginAt = session == null ? null : session.getAttribute(LOGIN_AT);
            boolean remembered =
                    session != null && Boolean.TRUE.equals(session.getAttribute(REMEMBER_ME));
            long timeoutMillis =
                    (remembered
                                    ? properties.getRememberMeTimeout()
                                    : properties.getAbsoluteTimeout())
                            .toMillis();
            try {
                if (!(loginAt instanceof Long timestamp)
                        || clock.millis() - timestamp >= timeoutMillis) {
                    throw new ApiException(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
                }
                if (remembered) {
                    long remainingMillis = timeoutMillis - (clock.millis() - (Long) loginAt);
                    session.setMaxInactiveInterval(
                            (int) Math.max(1, (remainingMillis + 999) / 1000));
                }
                Object fingerprint = session.getAttribute(PASSWORD_FINGERPRINT);
                request.setAttribute(
                        ACCOUNT,
                        auth.activeAccount(
                                authentication.getName(),
                                fingerprint instanceof String value ? value : null));
            } catch (ApiException exception) {
                if (exception.getStatus() != 401) {
                    throw exception;
                }
                if (session != null) {
                    session.invalidate();
                }
                SecurityContextHolder.clearContext();
                // 公共认证入口仍可重新获取 token；私有写请求也须在 CSRF 前返回 401。
                if (!isPublicAuth(path) && path.startsWith("/api/")) {
                    throw exception;
                }
            }
        }
        if (path.startsWith("/api/")
                && !isPublicAuth(path)
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            throw new ApiException(401, "UNAUTHENTICATED", "请先登录");
        }
        if ("POST".equals(request.getMethod()) && "/api/auth/password".equals(path)) {
            limits.passwordRequest(request.getRemoteAddr());
        }
        chain.doFilter(request, response);
    }

    private boolean isPublicAuth(String path) {
        return path.equals("/api/auth/wechat/login")
                || path.equals("/api/auth/wechat/register")
                || path.equals("/api/auth/wechat/bind")
                || path.equals("/api/auth/qr")
                || path.startsWith("/api/auth/qr/")
                || path.equals("/api/auth/csrf")
                || path.equals("/api/auth/config")
                || path.equals("/api/auth/login")
                || path.equals("/api/auth/register")
                || path.equals("/api/auth/logout");
    }
}
