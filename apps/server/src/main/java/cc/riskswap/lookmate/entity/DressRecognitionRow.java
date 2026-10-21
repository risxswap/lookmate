package cc.riskswap.lookmate.entity;

import java.time.LocalDateTime;
import java.util.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
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
