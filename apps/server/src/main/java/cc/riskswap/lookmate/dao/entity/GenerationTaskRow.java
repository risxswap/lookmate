package cc.riskswap.lookmate.dao.entity;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class GenerationTaskRow {
    private Long id;
    private Long userId;
    private String designType;
    private String status;
    private String clientRequestId;
    private String requestHash;
    private String inputSnapshot;
    private String modelConfigSnapshot;
    private Long retryOfTaskId;
    private Long retrySourceId;
    private String resumeStage;
    private Long currentCallId;
    private String attemptToken;
    private LocalDateTime leaseUntil;
    private String outcomeSnapshot;
    private String errorCode;
    private String errorMessage;
    private LocalDateTime hiddenAt;
}
