package cc.riskswap.lookmate.common.model.dto;

import lombok.*;

@Getter
@AllArgsConstructor
public class FileDto {
    private String id;
    private String status;
    private String mimeType;
    private Long sizeBytes;
    private Integer width;
    private Integer height;
    private String validationError;
}
