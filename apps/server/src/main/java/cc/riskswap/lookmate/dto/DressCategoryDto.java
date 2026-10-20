package cc.riskswap.lookmate.dto;
import lombok.*;
import java.util.*;
import java.time.LocalDateTime;
@Getter @Setter @NoArgsConstructor
public class DressCategoryDto {
    private String id;
    private String code;
    private String name;
    private Integer sortOrder;
}
