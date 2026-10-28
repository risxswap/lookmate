package cc.riskswap.lookmate.dao.entity;

import java.time.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class OutfitPlanRow {
    private Long id;
    private Long userId;
    private LocalDate planDate;
    private String scene;
    private String note;
    private Long version;
    private Long sourceOutfitId;
    private String snapshot;
    private String clientRequestId;
    private String requestHash;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
