package cc.riskswap.lookmate.entity;

import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FileAssetRow {
    private Long id;
    private Long userId;
    private Long sizeBytes;
    private String bucket;
    private String storageKey;
    private String originalKey;
    private String thumbnailKey;
    private String originalName;
    private String mimeType;
    private String status;
    private String verificationToken;
    private String validationError;
    private Integer width;
    private Integer height;
    private Instant dbNow;
    private Instant expiresAt;
    private Instant cleanupAfter;
    private Instant verificationLeaseUntil;
    private Instant createdAt;
    private Instant updatedAt;
}
