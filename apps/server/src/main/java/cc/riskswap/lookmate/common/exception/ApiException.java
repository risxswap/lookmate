package cc.riskswap.lookmate.common.exception;

import lombok.Getter;

@Getter
public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    private final Long retryAfterSeconds;

    public ApiException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public ApiException(int status, String code, String message, Long retryAfterSeconds) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
