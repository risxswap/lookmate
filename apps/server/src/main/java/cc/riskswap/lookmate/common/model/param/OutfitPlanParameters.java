package cc.riskswap.lookmate.common.model.param;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;

public final class OutfitPlanParameters {
    private OutfitPlanParameters() {}

    public static ApiException invalid() {
        return new ApiException(400, "INVALID_REQUEST", "穿搭计划参数不合法");
    }

    public static void fields(Map<String, Object> body, Set<String> allowed) {
        if (body == null || !allowed.containsAll(body.keySet())) throw invalid();
    }

    public static String text(Object raw, int max, boolean nullable) {
        if (raw == null && nullable) return null;
        if (!(raw instanceof String s)) throw invalid();
        s = s.replaceAll("^[\\s\\p{Z}]+|[\\s\\p{Z}]+$", "");
        if ((!nullable && s.isEmpty()) || s.codePointCount(0, s.length()) > max) throw invalid();
        return s;
    }

    public static long id(Object raw) {
        try {
            return OutfitParameters.id(raw);
        } catch (ApiException e) {
            throw invalid();
        }
    }

    public static long version(Object raw) {
        try {
            return OutfitParameters.version(raw);
        } catch (ApiException e) {
            throw invalid();
        }
    }

    public static int page(String raw, int fallback, int max) {
        try {
            return OutfitParameters.page(raw, fallback, max);
        } catch (ApiException e) {
            throw invalid();
        }
    }

    public static LocalDate date(Object raw) {
        if (!(raw instanceof String s) || !s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw invalid();
        try {
            var d = LocalDate.parse(s);
            if (d.getYear() < 1000) throw invalid();
            return d;
        } catch (DateTimeParseException e) {
            throw invalid();
        }
    }

    public static String requestId(Object raw) {
        if (!(raw instanceof String s)
                || !s.matches(
                        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw invalid();
        return UUID.fromString(s).toString();
    }

    public static ApiException conflict() {
        return new ApiException(409, "VERSION_CONFLICT", "内容已更新，请刷新核对后重试");
    }
}
