package cc.riskswap.lookmate.dto;
import lombok.*;
import java.util.*;
import java.time.LocalDateTime;
@Getter @Setter @NoArgsConstructor
public class DressRecognitionDto {
    private String id;
    private String status;
    private String errorCode;
    private String errorMessage;
    private String createdAt;
    private String updatedAt;
}
