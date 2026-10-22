package cc.riskswap.lookmate.common.model.param;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.util.*;

public final class OutfitParameters {
    private OutfitParameters() {}

    public static ApiException invalid() {
        return new ApiException(400, "VALIDATION_ERROR", "搭配参数不合法");
    }

    public static void fields(Map<String, Object> body, Set<String> allowed) {
        if (body == null || !allowed.containsAll(body.keySet())) throw invalid();
    }

    public static long id(Object raw) {
        if (!(raw instanceof String s) || !s.matches("[1-9][0-9]{0,18}")) throw invalid();
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            throw invalid();
        }
    }

    public static long version(Object raw) {
        if (!(raw instanceof String s) || !s.matches("0|[1-9][0-9]{0,18}")) throw invalid();
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            throw invalid();
        }
    }

    public static String text(Object raw, int max, boolean nullable) {
        if (raw == null && nullable) return null;
        if (!(raw instanceof String s)) throw invalid();
        s = s.replaceAll("^[\\s\\p{Z}]+|[\\s\\p{Z}]+$", "");
        if ((s.isEmpty() && !nullable) || s.codePointCount(0, s.length()) > max) throw invalid();
        return s;
    }

    public static List<Long> ids(Object raw, int min, int max) {
        if (!(raw instanceof List<?> list) || list.size() < min || list.size() > max)
            throw invalid();
        var result = list.stream().map(OutfitParameters::id).toList();
        if (new HashSet<>(result).size() != result.size()) throw invalid();
        return result;
    }

    public static boolean flag(Object raw) {
        if (!(raw instanceof Boolean b)) throw invalid();
        return b;
    }

    public static int page(String raw, int fallback, int max) {
        if (raw == null) return fallback;
        long value = id(raw);
        if (value > max) throw invalid();
        return (int) value;
    }
}
