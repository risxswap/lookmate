package cc.riskswap.lookmate.common.model.dto;

import java.util.*;
import lombok.*;

@Getter
@Setter
public class OutfitDto {
    private String id;
    private String name;
    private String note;
    private boolean pinned;
    private String version;
    private String revision;
    private List<OutfitGroupDto> groups;
    private List<String> scenes;
    private List<Map<String, Object>> items;
    private String sourceDesignId;
    private String sourceOutputFileId;
    private String createdAt;
    private String updatedAt;
}
