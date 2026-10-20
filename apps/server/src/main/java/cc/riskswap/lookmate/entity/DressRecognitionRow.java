package cc.riskswap.lookmate.entity;
import lombok.*;
import java.util.*;
import java.time.LocalDateTime;
@Getter @Setter @NoArgsConstructor
public class DressRecognitionRow {
    private Long id;
    private Long dressId;
    private Long imageRevision;
    private Integer attemptNo;
    private String status;
    private String errorCode;
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
