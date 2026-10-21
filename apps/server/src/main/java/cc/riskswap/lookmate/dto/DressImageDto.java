package cc.riskswap.lookmate.dto;

import java.util.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
public class DressImageDto {
    private String id;
    private String fileId;
    private String version;
    private String recognitionId;
    private Integer sortOrder;
    private boolean aiCurrent;
    private Map<String, Object> aiFeatures;
    private Map<String, Object> manualFeatures;
    private Map<String, Object> effectiveFeatures;
}
