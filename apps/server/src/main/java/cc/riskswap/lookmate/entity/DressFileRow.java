package cc.riskswap.lookmate.entity;
import lombok.*;
import java.util.*;
import java.time.LocalDateTime;
@Getter @Setter @NoArgsConstructor
public class DressFileRow {
    private Long id;
    private String mimeType;
    private Long sizeBytes;
    private Integer width;
    private Integer height;
    private String status;
    private boolean expired;
    private LocalDateTime expiresAt;
}
