package cc.riskswap.lookmate.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
@RequiredArgsConstructor
public class ApiExceptionHandler {
    private final ApiErrors errors;

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> business(
            ApiException exception, HttpServletRequest request) {
        var response = ResponseEntity.status(exception.getStatus());
        if (exception.getRetryAfterSeconds() != null) {
            response.header("Retry-After", exception.getRetryAfterSeconds().toString());
        }
        return response.body(errors.body(request, exception));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> validation(
            MethodArgumentNotValidException exception, HttpServletRequest request) {
        var body = errors.body(request, new ApiException(400, "VALIDATION_ERROR", "请检查填写内容"));
        body.put(
                "fieldErrors",
                exception.getBindingResult().getFieldErrors().stream()
                        .map(
                                error ->
                                        Map.of(
                                                "field",
                                                error.getField(),
                                                "message",
                                                error.getDefaultMessage() == null
                                                        ? "输入不合法"
                                                        : error.getDefaultMessage()))
                        .toList());
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> malformed(HttpServletRequest request) {
        return business(new ApiException(400, "VALIDATION_ERROR", "请求字段或格式不正确"), request);
    }

    @ExceptionHandler({DataAccessException.class, CannotCreateTransactionException.class})
    public ResponseEntity<Map<String, Object>> unavailable(HttpServletRequest request) {
        return business(new ApiException(503, "SERVICE_UNAVAILABLE", "服务暂不可用，请稍后重试"), request);
    }
}
