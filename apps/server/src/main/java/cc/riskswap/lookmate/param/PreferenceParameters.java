package cc.riskswap.lookmate.param;

import java.text.Normalizer;
import java.util.*;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.entity.PreferenceRow;
import tools.jackson.databind.json.JsonMapper;

/** Normalizes only explicit patch fields; merged conflicts are checked under the user lock. */
public final class PreferenceParameters {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    public static final List<String> ARRAYS = List.of("interests", "styles", "preferredColors", "avoidedColors", "fits", "hairLengths", "restrictions");
    public static final List<String> TEXTS = List.of("dyeAcceptance", "permAcceptance", "groomingEffort", "outfitNote", "hairNote", "restrictionNote");
    private static final Map<String,String> INTERESTS = choices("HIKING:徒步,CAMPING:露营,CYCLING:骑行,RUNNING:跑步,FITNESS:健身,TRAVEL:旅行,PHOTOGRAPHY:摄影,MUSIC:音乐,READING:阅读,ART:艺术");
    private static final Map<String,String> STYLES = choices("MINIMAL:简约,CASUAL:休闲,BUSINESS:通勤,SPORTY:运动,OUTDOOR:户外,RETRO:复古,STREET:街头,ELEGANT:优雅,SWEET:甜美,ANDROGYNOUS:中性");
    private static final Map<String,String> COLORS = choices("BLACK:黑,WHITE:白,GRAY:灰,BEIGE:米色,BROWN:棕,RED:红,ORANGE:橙,YELLOW:黄,GREEN:绿,BLUE:蓝,PURPLE:紫,PINK:粉");
    private static final Map<String,Set<String>> ENUMS = Map.of(
            "fits", Set.of("LOOSE","REGULAR","SLIM"), "hairLengths", Set.of("SHORT","MEDIUM","LONG"),
            "restrictions", Set.of("NO_HIGH_HEELS","NO_MIDRIFF","NO_TIGHT","NO_SHORTENING"),
            "dyeAcceptance", Set.of("ACCEPT","REJECT"), "permAcceptance", Set.of("ACCEPT","REJECT"),
            "groomingEffort", Set.of("LOW","MEDIUM","HIGH"));
    private PreferenceParameters() { }

    public static Map<String,Object> patch(Map<String,Object> body) {
        var allowed = new HashSet<>(ARRAYS); allowed.addAll(TEXTS); allowed.add("version");
        ProfileParameters.fields(body, allowed);
        if (body.keySet().stream().noneMatch(key -> !key.equals("version"))) throw invalid("至少填写一个偏好字段");
        var result = new LinkedHashMap<String,Object>();
        body.forEach((key,value) -> {
            if (ARRAYS.contains(key)) result.put(key, array(key,value));
            else if (TEXTS.contains(key)) result.put(key, text(key,value));
        });
        return result;
    }

    private static List<?> array(String key, Object raw) {
        if (raw == null) return List.of();
        if (!(raw instanceof List<?> values) || values.size() > 20) throw invalid(key + " 最多选择 20 项，且必须是数组");
        var result = new LinkedHashSet<Object>();
        for (Object value : values) {
            if (ENUMS.containsKey(key)) {
                if (!(value instanceof String code) || !ENUMS.get(key).contains(code)) throw invalid(key + " 含未知选项");
                result.add(code);
            } else result.add(tag(key,value));
        }
        return new ArrayList<>(result);
    }

    private static Map<String,String> tag(String key, Object raw) {
        Map<String,String> choices = key.equals("interests") ? INTERESTS : key.equals("styles") ? STYLES : COLORS;
        if (!(raw instanceof Map<?,?> tag)) throw invalid(key + " 标签格式不正确");
        if ("PRESET".equals(tag.get("type")) && tag.keySet().equals(Set.of("type","code"))
                && tag.get("code") instanceof String code && choices.containsKey(code)) return Map.of("type","PRESET","code",code);
        if ("CUSTOM".equals(tag.get("type")) && tag.keySet().equals(Set.of("type","text")) && tag.get("text") instanceof String value) {
            String normalized = Normalizer.normalize(trim(value), Normalizer.Form.NFC);
            int length = normalized.codePointCount(0, normalized.length());
            if (length < 1 || length > 20) throw invalid(key + " 自定义标签须为 1～20 个字符");
            for (var choice : choices.entrySet()) if (choice.getValue().equals(normalized)) return Map.of("type","PRESET","code",choice.getKey());
            return Map.of("type","CUSTOM","text",normalized);
        }
        throw invalid(key + " 标签类型、编码或字段不正确");
    }

    private static String text(String key, Object raw) {
        if (raw == null) return null;
        if (!(raw instanceof String value)) throw invalid(key + " 必须是文本");
        if (ENUMS.containsKey(key)) {
            if (!ENUMS.get(key).contains(value)) throw invalid(key + " 含未知选项");
            return value;
        }
        value = trim(value);
        if (value.codePointCount(0,value.length()) > 500) throw invalid(key + " 最多 500 个字符");
        return value.isEmpty() ? null : value;
    }

    public static void validateMerged(Map<String,Object> merged) {
        var liked = new HashSet<>((List<?>) merged.get("preferredColors"));
        liked.retainAll((List<?>) merged.get("avoidedColors"));
        if (!liked.isEmpty()) throw invalid("喜欢与不喜欢的颜色不能相同");
        if (((List<?>)merged.get("fits")).contains("SLIM") && ((List<?>)merged.get("restrictions")).contains("NO_TIGHT"))
            throw invalid("修身版型与不穿紧身款的限制冲突");
    }

    public static Map<String,Object> values(PreferenceRow row) {
        var values = new LinkedHashMap<String,Object>();
        values.put("interests", row == null || row.getInterests() == null ? List.of() : JSON.readValue(row.getInterests(), List.class));
        values.put("styles", row == null || row.getStyles() == null ? List.of() : JSON.readValue(row.getStyles(), List.class));
        values.put("preferredColors", row == null || row.getPreferredColors() == null ? List.of() : JSON.readValue(row.getPreferredColors(), List.class));
        values.put("avoidedColors", row == null || row.getAvoidedColors() == null ? List.of() : JSON.readValue(row.getAvoidedColors(), List.class));
        values.put("fits", row == null || row.getFits() == null ? List.of() : JSON.readValue(row.getFits(), List.class));
        values.put("hairLengths", row == null || row.getHairLengths() == null ? List.of() : JSON.readValue(row.getHairLengths(), List.class));
        values.put("restrictions", row == null || row.getRestrictions() == null ? List.of() : JSON.readValue(row.getRestrictions(), List.class));
        values.put("dyeAcceptance", row == null ? null : row.getDyeAcceptance());
        values.put("permAcceptance", row == null ? null : row.getPermAcceptance());
        values.put("groomingEffort", row == null ? null : row.getGroomingEffort());
        values.put("outfitNote", row == null ? null : row.getOutfitNote());
        values.put("hairNote", row == null ? null : row.getHairNote());
        values.put("restrictionNote", row == null ? null : row.getRestrictionNote());
        return values;
    }

    public static PreferenceRow row(Long user, Map<String,Object> values) {
        var row = new PreferenceRow(); row.setUserId(user);
        row.setInterests(((List<?>) values.get("interests")).isEmpty() ? null : JSON.writeValueAsString(values.get("interests")));
        row.setStyles(((List<?>) values.get("styles")).isEmpty() ? null : JSON.writeValueAsString(values.get("styles")));
        row.setPreferredColors(((List<?>) values.get("preferredColors")).isEmpty() ? null : JSON.writeValueAsString(values.get("preferredColors")));
        row.setAvoidedColors(((List<?>) values.get("avoidedColors")).isEmpty() ? null : JSON.writeValueAsString(values.get("avoidedColors")));
        row.setFits(((List<?>) values.get("fits")).isEmpty() ? null : JSON.writeValueAsString(values.get("fits")));
        row.setHairLengths(((List<?>) values.get("hairLengths")).isEmpty() ? null : JSON.writeValueAsString(values.get("hairLengths")));
        row.setRestrictions(((List<?>) values.get("restrictions")).isEmpty() ? null : JSON.writeValueAsString(values.get("restrictions")));
        row.setDyeAcceptance((String) values.get("dyeAcceptance"));
        row.setPermAcceptance((String) values.get("permAcceptance"));
        row.setGroomingEffort((String) values.get("groomingEffort"));
        row.setOutfitNote((String) values.get("outfitNote"));
        row.setHairNote((String) values.get("hairNote"));
        row.setRestrictionNote((String) values.get("restrictionNote"));
        return row;
    }
    private static Map<String,String> choices(String text) {
        var result = new LinkedHashMap<String,String>();
        for (String entry : text.split(",")) { String[] pair = entry.split(":"); result.put(pair[0],pair[1]); }
        return Collections.unmodifiableMap(result);
    }
    public static String trim(String text) { return text.replaceAll("^[\\s\\p{Z}\\u0085\\u001c-\\u001f]+|[\\s\\p{Z}\\u0085\\u001c-\\u001f]+$", ""); }
    private static ApiException invalid(String message) { return new ApiException(400,"VALIDATION_ERROR",message); }
}
