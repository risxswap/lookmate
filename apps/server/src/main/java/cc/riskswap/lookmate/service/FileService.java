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
    private static final int MAX_BYTES = 20 * 1024 * 1024;
    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(FileService.class);
    private final Object admission = new Object();
    private final FileMapper files;
    private final ObjectStorage storage;
    private final AssetProperties properties;
    private final TransactionTemplate tx;
    private final ObjectMapper json;

    public FileService(
            FileMapper files,
            ObjectStorage storage,
            AssetProperties properties,
            PlatformTransactionManager tm,
            ObjectMapper json) {
        this.files = files;
        this.storage = storage;
        this.properties = properties;
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
                || p.getSizeBytes() > MAX_BYTES
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
                                            503, "UPLOAD_CAPACITY_EXCEEDED", "未完成上传较多，请稍后上传");
                                if (files.userPendingCount(user)
                                        >= properties.getUserPendingLimit())
                                    throw new ApiException(
                                            429, "UPLOAD_CAPACITY_EXCEEDED", "未完成上传较多，请稍后上传");
                                var r = new FileAssetRow();
                                r.setUserId(user);
                                r.setBucket(storage.bucket());
                                r.setOriginalName(p.getOriginalName());
                                String key = user + "/" + UUID.randomUUID();
                                r.setOriginalKey("original/" + key);
                                r.setStorageKey(r.getOriginalKey());
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
                storage.uploadToken(row.getOriginalKey(), seconds, MAX_BYTES),
                "expiresAt",
                Instant.now().plusSeconds(seconds));
    }

    public FileDto get(Long user, String id) {
        return dto(require(user, RecordParameters.id(id)));
    }

    public FileDto complete(Long user, String id) {
        available();
        Long fileId = RecordParameters.id(id);
        var initial = require(user, fileId);
        requireCompletable(initial);
        if (Set.of("TEMP", "READY").contains(initial.getStatus())) return dto(initial);
        ObjectStorage.Metadata metadata;
        try {
            metadata = storage.stat(initial.getBucket(), initial.getOriginalKey());
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            LOG.warn(
                    "Upload completion deferred: id={}, type={}",
                    fileId,
                    e.getClass().getSimpleName());
            throw new ApiException(503, "STORAGE_UNAVAILABLE", "图片服务暂不可用，请稍后重试");
        }
        if (metadata == null) throw new ApiException(409, "UPLOAD_NOT_COMPLETE", "图片尚未上传完成，请重试");
        if (metadata.sizeBytes() < 1
                || metadata.sizeBytes() > MAX_BYTES
                || metadata.mimeType() == null
                || !Set.of("image/jpeg", "image/png", "image/webp").contains(metadata.mimeType()))
            throw new ApiException(400, "VALIDATION_ERROR", "请选择20 MB以内的JPEG、PNG或WebP图片");
        return tx.execute(
                s -> {
                    files.lockUser(user);
                    var row = files.lock(user, fileId);
                    if (row == null || "DELETING".equals(row.getStatus()))
                        throw new ApiException(404, "FILE_NOT_FOUND", "图片不存在");
                    requireCompletable(row);
                    if (Set.of("TEMP", "READY").contains(row.getStatus())) return dto(row);
                    FileAssetRow retired = null;
                    if (!Objects.equals(row.getStorageKey(), row.getOriginalKey())) {
                        retired = new FileAssetRow();
                        retired.setUserId(user);
                        retired.setBucket(row.getBucket());
                        retired.setStorageKey(row.getStorageKey());
                        if (!Objects.equals(row.getThumbnailKey(), row.getOriginalKey()))
                            retired.setThumbnailKey(row.getThumbnailKey());
                    }
                    row.setStorageKey(row.getOriginalKey());
                    row.setThumbnailKey(null);
                    row.setMimeType(metadata.mimeType());
                    row.setSizeBytes(metadata.sizeBytes());
                    row.setWidth(null);
                    row.setHeight(null);
                    if (files.complete(row) != 1)
                        throw new ApiException(409, "FILE_NOT_USABLE", "图片已过期或正在清理");
                    // Release the old unique (bucket, storage_key) before recording its cleanup.
                    if (retired != null) files.retireDerivatives(retired);
                    row.setStatus("TEMP");
                    row.setValidationError(null);
                    return dto(row);
                });
    }

    private static void requireCompletable(FileAssetRow row) {
        if (!Set.of("UPLOADING", "VERIFYING", "TEMP", "READY").contains(row.getStatus())
                || row.getCleanupAfter() != null
                || row.getExpiresAt() != null && !row.getExpiresAt().isAfter(row.getDbNow()))
            throw new ApiException(409, "FILE_NOT_USABLE", "图片已过期或不可用，请重新上传");
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
                variant.equals("DISPLAY")
                        ? storage.signedUrl(row.getBucket(), row.getStorageKey(), seconds)
                        : storage.thumbnailUrl(row.getBucket(), row.getStorageKey(), seconds),
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

    public void cleanup() {
        if (!storage.available() || properties.isMaintenance()) return;
        for (var row : files.garbage()) {
            Boolean claimed =
                    tx.execute(
                            s -> {
                                files.lockUser(row.getUserId());
                                var current = files.lock(row.getUserId(), row.getId());
                                if (current == null || files.directReferences(row.getId()) > 0)
                                    return false;
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
                var keys = new HashSet<String>();
                keys.add(row.getOriginalKey());
                keys.add(row.getStorageKey());
                keys.add(row.getThumbnailKey());
                keys.remove(null);
                for (String key : keys) storage.delete(row.getBucket(), key);
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
