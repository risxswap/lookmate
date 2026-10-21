package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DesignResultDto {
    private String id;
    private String title;
    private String summary;
    private String style;
    private String occasion;
    private String designReason;
    private String colorAdvice;
    private String wearingAdvice;
    private HairstyleDto hairstyle;
    private java.util.List<ResultItemDto> items;
    private String matchLevel;
    private java.util.List<java.util.Map<String, Object>> notices = java.util.List.of();
    private java.util.Map<String, Object> illustrativeShoes;
    private java.util.Map<String, Object> novelty;
}
