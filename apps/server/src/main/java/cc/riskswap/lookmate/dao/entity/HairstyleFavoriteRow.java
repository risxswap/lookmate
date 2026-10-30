package cc.riskswap.lookmate.dao.entity;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class HairstyleFavoriteRow {
    private Long id;
    private String hairstyleId;
    private String displaySnapshot;
    private LocalDateTime createdAt;
}
