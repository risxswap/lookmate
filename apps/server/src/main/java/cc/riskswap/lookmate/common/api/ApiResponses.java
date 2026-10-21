package cc.riskswap.lookmate.common.api;

import cc.riskswap.lookmate.common.exception.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;

/** 统一构造响应体；HTTP 状态码和响应头由 Controller、异常处理器或过滤器设置。 */
public final class ApiResponses {
    private ApiResponses() {}

    public static <T> ApiResponse<T> ok(T data, HttpServletRequest request) {
        return new ApiResponse<>(data, (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }

    public static Map<String, Object> error(ApiException exception, HttpServletRequest request) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", exception.getCode());
        body.put("message", exception.getMessage());
        body.put("requestId", request.getAttribute(ApiErrors.REQUEST_ID));
        if (exception.getRetryAfterSeconds() != null) {
            body.put("retryAfterSeconds", exception.getRetryAfterSeconds());
        }
        return body;
    }
}
