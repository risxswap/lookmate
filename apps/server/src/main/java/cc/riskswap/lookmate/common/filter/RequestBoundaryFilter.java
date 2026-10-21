package cc.riskswap.lookmate.common.filter;

import cc.riskswap.lookmate.common.api.ApiErrors;
import cc.riskswap.lookmate.common.exception.ApiException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@RequiredArgsConstructor
public class RequestBoundaryFilter extends OncePerRequestFilter {
    private static final Logger LOG = LoggerFactory.getLogger(RequestBoundaryFilter.class);
    private final ApiErrors errors;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        request.setAttribute(ApiErrors.REQUEST_ID, requestId);
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Cache-Control", "no-store");
        try {
            chain.doFilter(request, response);
        } catch (Exception exception) {
            Throwable cause = exception;
            while (cause != null
                    && !(cause instanceof ApiException)
                    && !(cause instanceof DataAccessException)) {
                cause = cause.getCause();
            }
            if (cause instanceof ApiException apiException) {
                errors.write(request, response, apiException);
            } else if (cause instanceof DataAccessException) {
                errors.write(
                        request,
                        response,
                        new ApiException(503, "SERVICE_UNAVAILABLE", "服务暂不可用，请稍后重试"));
            } else {
                // 不输出异常消息或请求体，避免数据库连接信息及凭据泄露。
                LOG.error(
                        "Request failed: requestId={}, exceptionType={}",
                        requestId,
                        exception.getClass().getName());
                errors.write(
                        request, response, new ApiException(500, "INTERNAL_ERROR", "请求未完成，请稍后重试"));
            }
        }
    }
}
