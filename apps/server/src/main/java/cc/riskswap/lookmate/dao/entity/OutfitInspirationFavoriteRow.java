package cc.riskswap.lookmate.dao.entity;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class OutfitInspirationFavoriteRow {
    private Long id;
    private String inspirationId;
    private String displaySnapshot;
    private LocalDateTime createdAt;
}
