package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class OutfitPlanDto {
    private String id;
    private String version;
    private String date;
    private String scene;
    private String note;
    private String sourceOutfitId;
    private boolean sourceMissing;
    private OutfitDto outfit;
    private String createdAt;
    private String updatedAt;
}
