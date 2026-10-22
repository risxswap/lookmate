package cc.riskswap.lookmate.dao.entity;

import java.time.LocalDateTime;
import lombok.*;

@Getter
@Setter
public class OutfitRow {
    private Long id;
    private Long userId;
    private String name;
    private String note;
    private boolean pinned;
    private Long version;
    private Long revision;
    private Long sourceDesignId;
    private Long sourceOutputFileId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
