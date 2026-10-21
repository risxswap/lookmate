package cc.riskswap.lookmate.param;

import cc.riskswap.lookmate.api.ApiException;

public final class RecordParameters {
    private RecordParameters() {}

    public static Long id(String value) {
        if (value == null || !value.matches("[1-9][0-9]{0,18}")) throw invalid();
        try {
            return Long.valueOf(value);
        } catch (NumberFormatException error) {
            throw invalid();
        }
    }

    public static int page(String value, int fallback, int maximum) {
        if (value == null) return fallback;
        long number = id(value);
        if (number > maximum) throw invalid();
        return (int) number;
    }

    public static ApiException invalid() {
        return new ApiException(400, "INVALID_REQUEST", "查询参数或编号不合法");
    }
}
