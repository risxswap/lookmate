package cc.riskswap.lookmate.entity;

import lombok.*;

@Getter
@Setter
public class CollectionRow {
    private Long id;
    private String name;
    private Long version;
    private java.time.LocalDateTime createdAt;
    private java.time.LocalDateTime updatedAt;
}
