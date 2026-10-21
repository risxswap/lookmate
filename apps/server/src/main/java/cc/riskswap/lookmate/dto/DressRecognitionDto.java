package cc.riskswap.lookmate.dto;

import java.util.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
public class DressRecognitionDto {
    private String id;
    private String status;
    private String errorCode;
    private String errorMessage;
    private String createdAt;
    private String updatedAt;
}
