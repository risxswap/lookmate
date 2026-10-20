package cc.riskswap.lookmate.security;

import java.io.IOException;
import java.time.Clock;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.service.AuthRateLimiter;
import cc.riskswap.lookmate.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

@RequiredArgsConstructor
public class AuthGuardFilter extends OncePerRequestFilter {
    public static final String LOGIN_AT = "lookmate.loginAt";
    public static final String ACCOUNT = "lookmate.account";
    private final AuthService auth;
    private final AuthRateLimiter limits;
    private final AuthProperties properties;
    private final Clock clock;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getServletPath();
        if ("POST".equals(request.getMethod())
                && ("/api/auth/login".equals(path) || "/api/auth/register".equals(path))) {
            limits.request(request.getRemoteAddr(), path.endsWith("/register"));
        }
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            var session = request.getSession(false);
            Object loginAt = session == null ? null : session.getAttribute(LOGIN_AT);
            try {
                if (!(loginAt instanceof Long timestamp)
                        || clock.millis() - timestamp >= properties.getAbsoluteTimeout().toMillis()) {
                    throw new ApiException(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
                }
                request.setAttribute(ACCOUNT, auth.activeAccount(authentication.getName()));
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
        if (path.startsWith("/api/") && !isPublicAuth(path)
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            throw new ApiException(401, "UNAUTHENTICATED", "请先登录");
        }
        chain.doFilter(request, response);
    }

    private boolean isPublicAuth(String path) {
        return path.equals("/api/auth/csrf") || path.equals("/api/auth/config")
                || path.equals("/api/auth/login") || path.equals("/api/auth/register")
                || path.equals("/api/auth/logout");
    }
}

