package cc.riskswap.lookmate.entity;

import java.time.LocalDateTime;
import java.util.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
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
