package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PlatformCatalogAssetService {
    private final HairstyleCatalogService hairstyles;
    private final OutfitInspirationCatalogService inspirations;
    private final ObjectStorage storage;
    private final AssetProperties properties;
    private final ConcurrentMap<String, String> objectKeys = new ConcurrentHashMap<>();

    public Map<String, Object> access(
            String catalogue, String version, String filename, String variant) {
        if (!Set.of("THUMBNAIL", "DISPLAY").contains(variant == null ? "" : variant)) {
            throw new ApiException(400, "VALIDATION_ERROR", "图片版本不正确");
        }
        String resource = catalogue + "/" + version + "/" + filename;
        String key =
                objectKeys.computeIfAbsent(
                        resource, ignored -> objectKey(catalogue, version, filename));
        if (!storage.available() || properties.isMaintenance()) {
            throw new ApiException(503, "STORAGE_UNAVAILABLE", "图片存储暂不可用");
        }
        long seconds = Math.max(60, Math.min(900, properties.getAccessSeconds()));
        boolean thumbnail = variant.equals("THUMBNAIL");
        return Map.of(
                "url",
                storage.imageUrl(
                        storage.bucket(),
                        key,
                        seconds,
                        thumbnail ? 480 : 1280,
                        thumbnail ? 640 : 1280,
                        thumbnail ? 80 : 85),
                "expiresAt",
                Instant.now().plusSeconds(seconds));
    }

    private String objectKey(String catalogue, String version, String filename) {
        byte[] bytes =
                switch (catalogue) {
                    case "hairstyles" -> hairstyles.asset(version, filename);
                    case "outfit-inspirations" -> inspirations.asset(version, filename);
                    default -> throw new ApiException(404, "RESOURCE_NOT_FOUND", "参考图片不存在");
                };
        try {
            String hash =
                    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            return "platform-catalog/" + catalogue + "/" + version + "/" + hash + "/" + filename;
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
