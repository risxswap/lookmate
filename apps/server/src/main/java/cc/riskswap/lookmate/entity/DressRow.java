package cc.riskswap.lookmate.entity;
import lombok.*;
import java.util.*;
import java.time.LocalDateTime;
@Getter @Setter @NoArgsConstructor
public class DressRow {
    private Long id;
    private Long userId;
    private Long categoryId;
    private Long imageRevision;
    private String name;
    private String color;
    private String notes;
    private Integer seasonMask;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
