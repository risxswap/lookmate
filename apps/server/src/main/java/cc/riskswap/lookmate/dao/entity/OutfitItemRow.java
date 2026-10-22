package cc.riskswap.lookmate.dao.entity;

import lombok.*;

@Getter
@Setter
public class OutfitItemRow {
    private Long id;
    private Long userId;
    private Long outfitId;
    private Long dressId;
    private Integer position;
    private String snapshot;
    private boolean missing;
}
