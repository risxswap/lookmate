package cc.riskswap.lookmate.entity;

import lombok.*;

@Getter
@Setter
public class RecognitionWorkRow {
    private Long id;
    private Long userId;
    private Long dressId;
    private Long imageRevision;
    private Long currentCallId;
    private String status;
    private String inputSnapshot;
    private String configSnapshot;
    private String attemptToken;
}
