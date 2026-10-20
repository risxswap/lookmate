package cc.riskswap.lookmate.api;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class ApiErrors {
    public static final String REQUEST_ID = "lookmate.requestId";
    private final ObjectMapper objectMapper;

    public Map<String, Object> body(HttpServletRequest request, ApiException exception) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", exception.getCode());
        body.put("message", exception.getMessage());
        body.put("requestId", request.getAttribute(REQUEST_ID));
        if (exception.getRetryAfterSeconds() != null) {
            body.put("retryAfterSeconds", exception.getRetryAfterSeconds());
        }
        return body;
    }

    public void write(HttpServletRequest request, HttpServletResponse response, ApiException exception)
            throws IOException {
        if (response.isCommitted()) {
            return;
        }
        // 会话持久化可能在 MVC 选择输出流后失败，完整重置输出方式及旧响应头。
        response.reset();
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Request-Id", (String) request.getAttribute(REQUEST_ID));
        response.setStatus(exception.getStatus());
        response.setContentType("application/json;charset=UTF-8");
        if (exception.getRetryAfterSeconds() != null) {
            response.setHeader("Retry-After", exception.getRetryAfterSeconds().toString());
        }
        response.getOutputStream().write(objectMapper.writeValueAsString(body(request, exception))
                .getBytes(StandardCharsets.UTF_8));
    }
}
