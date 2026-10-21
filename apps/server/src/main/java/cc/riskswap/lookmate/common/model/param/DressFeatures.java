package cc.riskswap.lookmate.common.model.param;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.util.*;

/** Shared validation for sparse manual features and complete model features. */
public final class DressFeatures {
    public static final Set<String> KEYS =
            Set.of(
                    "viewType",
                    "description",
                    "colors",
                    "pattern",
                    "styleTags",
                    "fit",
                    "materialDescription",
                    "details");

    private DressFeatures() {}

    public static Map<String, Object> validate(Map<String, Object> input) {
        if (input == null || !KEYS.containsAll(input.keySet())) throw invalid();
        var result = new LinkedHashMap<String, Object>();
        input.forEach(
                (key, value) -> {
                    if (value == null) {
                        result.put(key, null);
                        return;
                    }
                    switch (key) {
                        case "viewType" -> {
                            if (!(value instanceof String s)
                                    || !Set.of("FRONT", "BACK", "SIDE", "DETAIL", "OTHER")
                                            .contains(s)) throw invalid();
                        }
                        case "colors", "styleTags" -> {
                            if (!(value instanceof List<?> list) || list.size() > 20)
                                throw invalid();
                            list.forEach(
                                    v -> {
                                        String s = text(v, 100, false);
                                        if (s.isBlank()) throw invalid();
                                    });
                        }
                        case "details" -> {
                            if (!(value instanceof Map<?, ?> map)
                                    || !Set.of("neckline", "sleeve", "pocket", "button")
                                            .containsAll(map.keySet())) throw invalid();
                            map.values().forEach(v -> text(v, 255, true));
                        }
                        default ->
                                text(
                                        value,
                                        switch (key) {
                                            case "description" -> 4000;
                                            case "pattern" -> 255;
                                            case "fit" -> 100;
                                            default -> 1000;
                                        },
                                        false);
                    }
                    result.put(key, value);
                });
        return result;
    }

    public static String text(Object value, int max, boolean nullable) {
        if (value == null && nullable) return null;
        if (!(value instanceof String s) || s.codePointCount(0, s.length()) > max) throw invalid();
        return s;
    }

    public static ApiException invalid() {
        return new ApiException(400, "VALIDATION_ERROR", "衣物资料或图片特征不合法");
    }
}
