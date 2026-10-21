package cc.riskswap.lookmate.dao.entity;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PhotoRow {
    private Long id;
    private Long userId;
    private Long assetId;
    private String photoType;
    private java.time.LocalDateTime createdAt;
    private java.time.LocalDateTime updatedAt;
}
