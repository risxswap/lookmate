package cc.riskswap.lookmate.dao.entity;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class AuthTicketRow {
    private Long id;
    private String ticketKey;
    private String kind;
    private String ownerHash;
    private String payload;
    private String status;
    private LocalDateTime expiresAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
