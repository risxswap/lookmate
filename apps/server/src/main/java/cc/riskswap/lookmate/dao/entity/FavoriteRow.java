package cc.riskswap.lookmate.dao.entity;

import lombok.*;

@Getter
@Setter
public class FavoriteRow {
    private Long id;
    private Long resultId;
    private Long taskId;
    private java.time.LocalDateTime createdAt;
}
