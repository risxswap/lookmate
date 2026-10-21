package cc.riskswap.lookmate.param;

import java.math.BigDecimal;
import java.util.*;
import cc.riskswap.lookmate.api.ApiException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

public final class ProfileParameters {
    private static final JsonMapper JSON=JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS, DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    public static final Set<String> MEASUREMENTS=Set.of("height","weight","neck","chest","underbust","waist","abdomen","hip","shoulder","backWidth","armLength","upperArm","forearm","wrist","frontWaistLength","backWaistLength","inseam","outseam","thigh","knee","calf","ankle","head","leftFootLength","rightFootLength","leftFootWidth","rightFootWidth");
    private ProfileParameters() { }
    @SuppressWarnings("unchecked")
    public static Map<String,Object> parse(String body) {
        try {
            Object value=JSON.readValue(body,Object.class);
            if(!(value instanceof Map<?,?>)) throw invalid();
            return (Map<String,Object>)value;
        } catch (tools.jackson.core.JacksonException error) { throw invalid(); }
    }
    public static void fields(Map<String,Object> body,Set<String> allowed) {
        if(body==null || !allowed.containsAll(body.keySet())) throw invalid();
    }
    public static Long version(Object value) {
        if(!(value instanceof String s) || !s.matches("[0-9]{1,19}")) throw invalid();
        try { return Long.valueOf(s); } catch(NumberFormatException error) { throw invalid(); }
    }
    public static Long id(Object value) {
        if(!(value instanceof String s)) throw invalid();
        try { return RecordParameters.id(s); } catch(ApiException error) { throw invalid(); }
    }
    public static BigDecimal measurement(Object value) {
        if(value==null) return null;
        if(!(value instanceof Number)) throw invalid();
        try {
            BigDecimal number=new BigDecimal(value.toString());
            if(number.signum()<=0 || number.compareTo(new BigDecimal("9999.99"))>0 || number.stripTrailingZeros().scale()>2) throw invalid();
            return number;
        } catch(NumberFormatException error) { throw invalid(); }
    }
    public static ApiException invalid() { return new ApiException(400,"VALIDATION_ERROR","请求字段或格式不正确"); }
}
