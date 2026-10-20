package cc.riskswap.lookmate.entity;
import lombok.*;
@Getter @Setter
public class RecognitionWorkRow {
    private Long id,userId,dressId,imageRevision,currentCallId;
    private String status,inputSnapshot,configSnapshot,attemptToken;
}
