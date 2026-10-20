package cc.riskswap.lookmate.entity;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TaskQueryRow {
    private Long id;
    private Long resultId;
    private Long favoriteId;
    private String designType;
    private String status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String title;
    private String summary;
    private String errorCode;
    private String errorMessage;
}
