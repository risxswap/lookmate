package cc.riskswap.lookmate.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ResultItemDto {
    private String dressId;
    private String dressName;
    private String categoryName;
    private String matchReason;
    private String wearingMethod;
}
