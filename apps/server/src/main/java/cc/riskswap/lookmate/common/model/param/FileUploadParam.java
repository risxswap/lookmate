package cc.riskswap.lookmate.common.model.param;

import lombok.*;

@Getter
@Setter
public class FileUploadParam {
    private String originalName;
    private String mimeType;
    private Long sizeBytes;
}
