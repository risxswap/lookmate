package cc.riskswap.lookmate.dto;
import lombok.*;
@Getter @AllArgsConstructor
public class FileDto {
    private String id,status,mimeType;
    private Long sizeBytes;
    private Integer width,height;
    private String validationError;
}
