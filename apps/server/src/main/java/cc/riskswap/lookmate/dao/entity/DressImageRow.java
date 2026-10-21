package cc.riskswap.lookmate.dao.entity;

import java.util.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
public class DressImageRow {
    private Long id;
    private Long userId;
    private Long dressId;
    private Long assetId;
    private Long version;
    private Long recognitionId;
    private Long recognitionRevision;
    private Integer sortOrder;
    private String viewType;
    private String description;
    private String colors;
    private String pattern;
    private String styleTags;
    private String fit;
    private String materialDescription;
    private String details;
    private String manualFeatures;
}
