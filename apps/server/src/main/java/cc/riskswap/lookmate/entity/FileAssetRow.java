package cc.riskswap.lookmate.entity;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
@Getter @Setter
public class FileAssetRow {
    private Long id,userId,sizeBytes;
    private String bucket,storageKey,originalKey,thumbnailKey,originalName,mimeType,status,verificationToken,validationError;
    private Integer width,height;
    private Instant dbNow;
    private Instant expiresAt,cleanupAfter,verificationLeaseUntil,createdAt,updatedAt;
}
