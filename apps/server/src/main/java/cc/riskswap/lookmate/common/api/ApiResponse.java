package cc.riskswap.lookmate.common.api;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class ApiResponse<T> {
    private final T data;
    private final String requestId;
}
