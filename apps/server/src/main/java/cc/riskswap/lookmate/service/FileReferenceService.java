package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.dao.mapper.DressMapper;
import cc.riskswap.lookmate.dao.mapper.FileMapper;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
@RequiredArgsConstructor
public class FileReferenceService {
    private final FileMapper files;
    private final DressMapper dresses;
    private final ObjectMapper json;

    /** Called after unlinking in the transaction holding the account lock. */
    void release(Long user, Long asset) {
        if (files.hasDirectReference(user, asset)) return;
        // A recognition can outlive its source. Keep a durable recheck while it holds the file.
        files.scheduleCleanup(user, asset, recognitionHolds(user, asset) ? 60 : 0);
    }

    boolean recognitionHolds(Long user, Long asset) {
        for (String snapshot : files.recognitionReferences(user)) {
            var root = json.readTree(snapshot);
            var images = root.path("images");
            if (root.path("schemaVersion").asInt() != 1 || !images.isArray()) return true;
            for (var image : images) {
                var id = image.path("assetId");
                if (!id.isString()
                        || !id.asText().matches("[1-9][0-9]*")
                        || id.asText().equals(asset.toString())) return true;
            }
        }
        return false;
    }

    /** Every mutation locks the account first, then the union of old/new assets in ID order. */
    void lockOutfitAssets(Long user, Collection<Long> oldAssets, Set<Long> nextAssets) {
        var all = new TreeSet<>(oldAssets);
        all.addAll(nextAssets);
        for (Long asset : all) {
            var file = dresses.file(user, asset);
            if (nextAssets.contains(asset)) {
                if (file == null
                        || !Set.of("TEMP", "READY").contains(file.getStatus())
                        || file.isExpired()
                        || ("TEMP".equals(file.getStatus()) && file.getExpiresAt() == null)
                        || file.getSizeBytes() == null
                        || file.getSizeBytes() < 1
                        || file.getSizeBytes() > 20L * 1024 * 1024
                        || file.getMimeType() == null
                        || !Set.of("image/jpeg", "image/png", "image/webp")
                                .contains(file.getMimeType()))
                    throw new ApiException(409, "FILE_NOT_USABLE", "搭配图片尚未就绪或已失效");
                dresses.bindFile(user, asset);
            }
        }
    }
}
