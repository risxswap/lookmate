package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.*;
import cc.riskswap.lookmate.entity.RecognitionWorkRow;
import cc.riskswap.lookmate.mapper.*;
import cc.riskswap.lookmate.storage.*;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class RecognitionExecutor {
    private final RecognitionWorkMapper work;
    private final FileMapper files;
    private final RecognitionGateway gateway;
    private final ObjectStorage storage;
    private final RecognitionAvailability availability;
    private final RecognitionProperties properties;
    private final AssetProperties assets;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final Semaphore providerSlots;

    public RecognitionExecutor(
            RecognitionWorkMapper work,
            FileMapper files,
            RecognitionGateway gateway,
            ObjectStorage storage,
            RecognitionAvailability availability,
            RecognitionProperties properties,
            AssetProperties assets,
            ObjectMapper json,
            PlatformTransactionManager manager) {
        this.work = work;
        this.files = files;
        this.gateway = gateway;
        this.storage = storage;
        this.availability = availability;
        this.properties = properties;
        this.assets = assets;
        this.json = json;
        tx = new TransactionTemplate(manager);
        providerSlots = new Semaphore(Math.max(1, properties.getProviderConcurrency()), true);
    }

    public List<RecognitionWorkRow> pending() {
        return !assets.isMaintenance() ? work.pending() : List.of();
    }

    public void execute(RecognitionWorkRow candidate) {
        if (!providerSlots.tryAcquire()) return;
        try {
            executeWithSlot(candidate);
        } finally {
            providerSlots.release();
        }
    }

    private void executeWithSlot(RecognitionWorkRow candidate) {
        candidate.setAttemptToken(UUID.randomUUID().toString());
        boolean claimed =
                Boolean.TRUE.equals(
                        tx.execute(
                                s -> {
                                    work.lockUser(candidate.getUserId());
                                    Long revision = work.revision(candidate);
                                    work.lockImages(candidate.getDressId());
                                    var row = work.lock(candidate);
                                    return row != null
                                            && Objects.equals(
                                                    revision, candidate.getImageRevision())
                                            && work.claim(candidate) == 1;
                                }));
        if (!claimed) return;
        boolean sent = false;
        try {
            if (!availability.available())
                throw new RecognitionFailure("RECOGNITION_UNAVAILABLE", false);
            if (!json.readTree(candidate.getConfigSnapshot())
                    .equals(json.readTree(availability.configSnapshot())))
                throw new RecognitionFailure("RECOGNITION_CONFIG_UNAVAILABLE", false);
            var images = json.readTree(candidate.getInputSnapshot()).path("images");
            if (!images.isArray() || images.isEmpty() || images.size() > properties.getMaxImages())
                throw new RecognitionFailure("RECOGNITION_INPUT_LIMIT", false);
            List<RecognitionGateway.Image> input = new ArrayList<>();
            for (var image : images) {
                long asset = Long.parseLong(image.path("assetId").asText());
                var file = files.find(candidate.getUserId(), asset);
                if (file == null || !"READY".equals(file.getStatus()))
                    throw new RecognitionFailure("RECOGNITION_INPUT_UNAVAILABLE", false);
                input.add(
                        new RecognitionGateway.Image(
                                image.path("imageId").asText(),
                                storage.signedUrl(file.getBucket(), file.getStorageKey(), 300)));
            }
            Boolean bound =
                    tx.execute(
                            s -> {
                                work.lockUser(candidate.getUserId());
                                Long revision = work.revision(candidate);
                                work.lockImages(candidate.getDressId());
                                var current = work.lock(candidate);
                                if (!active(candidate, current, revision)) return false;
                                Map<String, Object> call = new HashMap<>();
                                call.put("userId", candidate.getUserId());
                                call.put("id", candidate.getId());
                                call.put("model", properties.getModel());
                                work.call(call);
                                candidate.setCurrentCallId(
                                        ((Number) call.get("currentCallId")).longValue());
                                work.bind(candidate);
                                return true;
                            });
            if (!Boolean.TRUE.equals(bound)) return;
            sent = true;
            var result = gateway.recognize(properties.getModel(), input);
            try {
                Set<String> expected = new HashSet<>();
                input.forEach(i -> expected.add(i.imageId()));
                if (result == null
                        || result.features() == null
                        || !expected.equals(result.features().keySet()))
                    throw new IllegalArgumentException();
                for (var feature : result.features().values())
                    cc.riskswap.lookmate.param.DressFeatures.validate(feature);
            } catch (RuntimeException invalid) {
                throw new RecognitionFailure("INVALID_MODEL_OUTPUT", false);
            }
            finish(candidate, "SUCCEEDED", result, null);
        } catch (RecognitionFailure e) {
            finish(candidate, e.uncertain() ? "UNKNOWN" : "FAILED", null, e.code());
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            finish(
                    candidate,
                    sent ? "UNKNOWN" : "FAILED",
                    null,
                    sent ? "MODEL_RESULT_UNKNOWN" : "RECOGNITION_INPUT_UNAVAILABLE");
        }
    }

    private static boolean active(
            RecognitionWorkRow row, RecognitionWorkRow current, Long revision) {
        return current != null
                && "RUNNING".equals(current.getStatus())
                && Objects.equals(current.getAttemptToken(), row.getAttemptToken())
                && Objects.equals(revision, row.getImageRevision());
    }

    private void finish(
            RecognitionWorkRow row, String status, RecognitionGateway.Result result, String code) {
        tx.executeWithoutResult(
                s -> {
                    work.lockUser(row.getUserId());
                    Long revision = work.revision(row);
                    work.lockImages(row.getDressId());
                    var current = work.lock(row);
                    if (!active(row, current, revision)) {
                        // A late response still closes its own call audit, but cannot write current
                        // image features.
                        if (current != null
                                && row.getCurrentCallId() != null
                                && Objects.equals(
                                        row.getCurrentCallId(), current.getCurrentCallId()))
                            work.finishCall(
                                    row.getCurrentCallId(),
                                    status,
                                    result == null ? null : result.requestId(),
                                    code,
                                    code == null ? null : "历史识别调用已结束");
                        return;
                    }
                    String message =
                            code == null
                                    ? null
                                    : status.equals("UNKNOWN")
                                            ? "识别结果尚不能确认，请确认后重试"
                                            : "自动识别未完成，可手动填写或稍后重试";
                    if (result != null) {
                        var expected = json.readTree(row.getInputSnapshot()).path("images");
                        Set<String> ids = new HashSet<>();
                        expected.forEach(i -> ids.add(i.path("imageId").asText()));
                        if (!ids.equals(result.features().keySet()))
                            throw new IllegalArgumentException("Model image set mismatch");
                        for (var entry : result.features().entrySet()) {
                            var features =
                                    cc.riskswap.lookmate.param.DressFeatures.validate(
                                            entry.getValue());
                            Map<String, Object> values = new HashMap<>();
                            for (String key :
                                    List.of(
                                            "viewType",
                                            "description",
                                            "colors",
                                            "pattern",
                                            "styleTags",
                                            "fit",
                                            "materialDescription",
                                            "details")) {
                                Object value = features.get(key);
                                values.put(
                                        key,
                                        value != null
                                                        && Set.of("colors", "styleTags", "details")
                                                                .contains(key)
                                                ? json.writeValueAsString(value)
                                                : value);
                            }
                            values.put("recognitionId", row.getId());
                            values.put("userId", row.getUserId());
                            values.put("dressId", row.getDressId());
                            values.put("imageId", Long.valueOf(entry.getKey()));
                            if (work.features(values) != 1)
                                throw new IllegalStateException("Image set changed");
                        }
                    }
                    work.finish(
                            row.getId(),
                            row.getAttemptToken(),
                            status,
                            result == null ? null : json.writeValueAsString(result.features()),
                            code,
                            message,
                            status.equals("UNKNOWN") ? 1 : 0);
                    if (current.getCurrentCallId() != null)
                        work.finishCall(
                                current.getCurrentCallId(),
                                status,
                                result == null ? null : result.requestId(),
                                code,
                                message);
                });
    }

    public void recover() {
        if (assets.isMaintenance()) return;
        for (var row : work.expired())
            finish(
                    row,
                    row.getCurrentCallId() == null ? "FAILED" : "UNKNOWN",
                    null,
                    row.getCurrentCallId() == null
                            ? "RECOGNITION_INTERRUPTED"
                            : "MODEL_RESULT_UNKNOWN");
    }
}
