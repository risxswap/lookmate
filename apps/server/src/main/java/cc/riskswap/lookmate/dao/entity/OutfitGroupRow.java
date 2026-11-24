package cc.riskswap.lookmate.dao.entity;

import java.time.LocalDateTime;
import lombok.*;

@Getter
@Setter
public class OutfitGroupRow {
    private Long id;
    private Long outfitId; // Present on a membership projection.
    private Long userId;
    private String name;
    private Long version;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
