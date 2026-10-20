package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.param.DressFeatures;
import cc.riskswap.lookmate.api.ApiException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class DressFeaturesTest {
    @Test void sparseNullsRemainDistinctFromAbsentKeys() {
        var input=new HashMap<String,Object>(); input.put("pattern",null); input.put("colors",List.of("白"));
        var output=DressFeatures.validate(input);
        assertThat(output).containsEntry("pattern",null).doesNotContainKey("viewType");
        assertThat(DressFeatures.validate(Map.of("description","😀".repeat(4000)))).containsKey("description");
    }
    @Test void rejectsUnknownKeysWrongTypesAndNestedLimits() {
        for(var input:List.<Map<String,Object>>of(Map.of("unknown","x"),Map.of("viewType","unknown"),Map.of("colors",List.of(2)),Map.of("styleTags",List.of(" ")),Map.of("details",Map.of("secret","x")),Map.of("details",Map.of("neckline",false)),Map.of("pattern","😀".repeat(256))))
            assertThatThrownBy(()->DressFeatures.validate(input)).isInstanceOf(ApiException.class);
    }
}
