package cc.riskswap.lookmate.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PhotoDto {
    private String id;
    private String fileId;
    private String photoType;
    private String createdAt;
    private String updatedAt;
}
