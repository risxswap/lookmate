package cc.riskswap.lookmate.common.api;

import cc.riskswap.lookmate.common.exception.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
@RequiredArgsConstructor
public class ApiErrors {
    public static final String REQUEST_ID = "lookmate.requestId";
    private final ObjectMapper objectMapper;

    public void write(
            HttpServletRequest request, HttpServletResponse response, ApiException exception)
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
        response.getOutputStream()
                .write(
                        objectMapper
                                .writeValueAsString(ApiResponses.error(exception, request))
                                .getBytes(StandardCharsets.UTF_8));
    }
}
