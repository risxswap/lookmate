package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.FileDto;
import cc.riskswap.lookmate.common.model.param.*;
import cc.riskswap.lookmate.common.util.*;
import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.dao.entity.FileAssetRow;
import cc.riskswap.lookmate.dao.mapper.FileMapper;
import cc.riskswap.lookmate.integration.ai.*;
import cc.riskswap.lookmate.integration.storage.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class FileService {
    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(FileService.class);
    private final Object admission = new Object();
    private final Set<Long> active = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final FileMapper files;
    private final ObjectStorage storage;
    private final AssetProperties properties;
    private final ImageProcessor processor;
    private final TransactionTemplate tx;
    private final ObjectMapper json;

    public FileService(
            FileMapper files,
            ObjectStorage storage,
            AssetProperties properties,
            ImageProcessor processor,
            PlatformTransactionManager tm,
            ObjectMapper json) {
        this.files = files;
        this.storage = storage;
        this.properties = properties;
        this.processor = processor;
        this.tx = new TransactionTemplate(tm);
        this.json = json;
    }

    private void available() {
        if (!storage.available() || properties.isMaintenance())
            throw new ApiException(503, "STORAGE_UNAVAILABLE", "图片服务暂不可用，请稍后重试");
    }

    public Map<String, Object> intent(Long user, FileUploadParam p) {
        available();
        if (p.getOriginalName() == null
                || p.getOriginalName().isBlank()
                || p.getOriginalName().codePointCount(0, p.getOriginalName().length()) > 255
                || p.getSizeBytes() == null
                || p.getSizeBytes() < 1
                || p.getSizeBytes() > ImageProcessor.MAX_BYTES
                || p.getMimeType() == null
                || !Set.of("image/jpeg", "image/png", "image/webp").contains(p.getMimeType()))
            throw new ApiException(400, "VALIDATION_ERROR", "请选择20 MB以内的JPEG、PNG或WebP图片");
        FileAssetRow row;
        synchronized (admission) {
            row =
                    tx.execute(
                            s -> {
                                files.lockUser(user);
                                if (files.pendingCount() >= properties.getPendingLimit())
                                    throw new ApiException(
                                            503, "UPLOAD_CAPACITY_EXCEEDED", "待核验图片较多，请稍后上传");
                                if (files.userPendingCount(user)
                                        >= properties.getUserPendingLimit())
                                    throw new ApiException(
                                            429, "UPLOAD_CAPACITY_EXCEEDED", "待核验图片较多，请稍后上传");
                                var r = new FileAssetRow();
                                r.setUserId(user);
                                r.setBucket(storage.bucket());
                                r.setOriginalName(p.getOriginalName());
                                String key = user + "/" + UUID.randomUUID();
                                r.setOriginalKey("original/" + key);
                                r.setStorageKey("display/" + key + ".jpg");
                                r.setThumbnailKey("thumbnail/" + key + ".jpg");
                                files.insert(r);
                                return r;
                            });
        }
        long seconds = Math.max(60, Math.min(3600, properties.getTokenSeconds()));
        return Map.of(
                "fileId",
                row.getId().toString(),
                "key",
                row.getOriginalKey(),
                "uploadUrl",
                storage.uploadUrl(),
                "token",
                storage.uploadToken(row.getOriginalKey(), seconds, ImageProcessor.MAX_BYTES),
                "expiresAt",
                Instant.now().plusSeconds(seconds));
    }

    public FileDto get(Long user, String id) {
        return dto(require(user, RecordParameters.id(id)));
    }

    public FileDto complete(Long user, String id) {
        available();
        return tx.execute(
                s -> {
                    files.lockUser(user);
                    var row = require(user, RecordParameters.id(id));
                    files.notifyComplete(row.getId());
                    return dto(row);
                });
    }

    public Map<String, Object> access(Long user, String id, String variant) {
        var row = require(user, RecordParameters.id(id));
        if (!Set.of("DISPLAY", "THUMBNAIL").contains(variant == null ? "" : variant))
            throw new ApiException(400, "VALIDATION_ERROR", "图片版本不正确");
        if (!Set.of("TEMP", "READY").contains(row.getStatus())
                || row.getExpiresAt() != null && !row.getExpiresAt().isAfter(row.getDbNow()))
            throw new ApiException(409, "FILE_NOT_USABLE", "图片尚不可用");
        available();
        long seconds = Math.max(60, Math.min(900, properties.getAccessSeconds()));
        return Map.of(
                "url",
                storage.signedUrl(
                        row.getBucket(),
                        variant.equals("DISPLAY") ? row.getStorageKey() : row.getThumbnailKey(),
                        seconds),
                "expiresAt",
                Instant.now().plusSeconds(seconds));
    }

    private FileAssetRow require(Long user, Long id) {
        var r = files.find(user, id);
        if (r == null || "DELETING".equals(r.getStatus()))
            throw new ApiException(404, "FILE_NOT_FOUND", "图片不存在");
        return r;
    }

    private static FileDto dto(FileAssetRow r) {
        return new FileDto(
                r.getId().toString(),
                r.getStatus(),
                r.getMimeType(),
                r.getSizeBytes(),
                r.getWidth(),
                r.getHeight(),
                r.getValidationError());
    }

    public List<FileAssetRow> pending() {
        return storage.available() && !properties.isMaintenance() ? files.candidates() : List.of();
    }

    public void verify(FileAssetRow candidate) {
        if (!active.add(candidate.getId())) return;
        try {
            verifyActive(candidate);
        } finally {
            active.remove(candidate.getId());
        }
    }

    private void verifyActive(FileAssetRow candidate) {
        String token = UUID.randomUUID().toString();
        Boolean claimed =
                tx.execute(
                        s -> {
                            files.lockUser(candidate.getUserId());
                            return files.claim(
                                            candidate.getId(),
                                            token,
                                            Math.max(300, properties.getVerificationLeaseSeconds()))
                                    == 1;
                        });
        if (!Boolean.TRUE.equals(claimed)) return;
        try {
            var image =
                    processor.process(
                            storage.read(
                                    candidate.getBucket(),
                                    candidate.getOriginalKey(),
                                    ImageProcessor.MAX_BYTES));
            storage.put(
                    candidate.getBucket(),
                    candidate.getStorageKey(),
                    image.display(),
                    "image/jpeg");
            storage.put(
                    candidate.getBucket(),
                    candidate.getThumbnailKey(),
                    image.thumbnail(),
                    "image/jpeg");
            candidate.setVerificationToken(token);
            candidate.setSizeBytes((long) image.display().length);
            candidate.setWidth(image.width());
            candidate.setHeight(image.height());
            tx.executeWithoutResult(
                    s -> {
                        files.lockUser(candidate.getUserId());
                        files.ready(candidate);
                    });
        } catch (InvalidImageException e) {
            tx.executeWithoutResult(
                    s -> {
                        files.lockUser(candidate.getUserId());
                        files.reject(candidate.getId(), token, e.getMessage());
                    });
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            LOG.warn(
                    "File verification deferred: id={}, type={}",
                    candidate.getId(),
                    e.getClass().getSimpleName());
            tx.executeWithoutResult(
                    s -> {
                        files.lockUser(candidate.getUserId());
                        files.defer(
                                candidate.getId(),
                                token,
                                Math.max(3, properties.getRetryDelaySeconds()));
                    });
        }
    }

    public void cleanup() {
        if (!storage.available() || properties.isMaintenance()) return;
        for (var row : files.garbage()) {
            if (active.contains(row.getId())) continue;
            Boolean claimed =
                    tx.execute(
                            s -> {
                                files.lockUser(row.getUserId());
                                var current = files.lock(row.getUserId(), row.getId());
                                if (active.contains(row.getId())
                                        || current == null
                                        || files.directReferences(row.getId()) > 0) return false;
                                if ("VERIFYING".equals(current.getStatus())
                                        && current.getVerificationLeaseUntil() != null
                                        && current.getVerificationLeaseUntil()
                                                .isAfter(current.getDbNow())) return false;
                                if (!"DELETING".equals(current.getStatus())
                                        && !(current.getExpiresAt() != null
                                                && !current.getExpiresAt()
                                                        .isAfter(current.getDbNow()))
                                        && !(current.getCleanupAfter() != null
                                                && !current.getCleanupAfter()
                                                        .isAfter(current.getDbNow()))) return false;
                                for (String snapshot :
                                        files.recognitionReferences(row.getUserId())) {
                                    var root = json.readTree(snapshot);
                                    if (root.path("schemaVersion").asInt() != 1) return false;
                                    var images = root.path("images");
                                    if (!images.isArray())
                                        return false; // Fail closed for unrecognized historical
                                    // snapshots.
                                    for (var image : images) {
                                        if (!image.path("assetId").isString()
                                                || !image.path("assetId")
                                                        .asText()
                                                        .matches("[1-9][0-9]*")) return false;
                                        if (image.path("assetId")
                                                .asText()
                                                .equals(row.getId().toString())) return false;
                                    }
                                }
                                files.deleting(row.getId());
                                return true;
                            });
            if (!Boolean.TRUE.equals(claimed)) continue;
            try {
                storage.delete(row.getBucket(), row.getOriginalKey());
                storage.delete(row.getBucket(), row.getStorageKey());
                storage.delete(row.getBucket(), row.getThumbnailKey());
                tx.executeWithoutResult(
                        s -> {
                            files.lockUser(row.getUserId());
                            files.delete(row.getId());
                        });
            } catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                LOG.warn(
                        "File cleanup deferred: id={}, type={}",
                        row.getId(),
                        e.getClass().getSimpleName());
            }
        }
    }
}
