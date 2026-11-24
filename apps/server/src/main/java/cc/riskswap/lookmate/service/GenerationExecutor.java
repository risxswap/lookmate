package cc.riskswap.lookmate.service;

import static cc.riskswap.lookmate.service.GenerationService.*;

import cc.riskswap.lookmate.common.util.GenerationLog;
import cc.riskswap.lookmate.common.util.ImageComposition;
import cc.riskswap.lookmate.config.*;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.integration.ai.*;
import cc.riskswap.lookmate.integration.storage.*;
import java.io.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class GenerationExecutor {
    private final GenerationMapper tasks;
    private final FileMapper files;
    private final GenerationService service;
    private final GenerationEngine engine;
    private final GenerationGateway gateway;
    private final HairstyleCatalogService hairstyles;
    private final OutfitInspirationCatalogService inspirations;
    private final ObjectStorage storage;
    private final GeneratedImageValidator processor;
    private final GenerationProperties properties;
    private final AssetProperties assets;
    private final PlanningSlots slots;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final java.util.concurrent.ConcurrentMap<Long, String> running =
            new java.util.concurrent.ConcurrentHashMap<>();

    public GenerationExecutor(
            GenerationMapper tasks,
            FileMapper files,
            GenerationService service,
            GenerationEngine engine,
            GenerationGateway gateway,
            ObjectStorage storage,
            GeneratedImageValidator processor,
            GenerationProperties properties,
            AssetProperties assets,
            PlanningSlots slots,
            ObjectMapper json,
            PlatformTransactionManager manager,
            HairstyleCatalogService hairstyles,
            OutfitInspirationCatalogService inspirations) {
        this.tasks = tasks;
        this.files = files;
        this.service = service;
        this.engine = engine;
        this.gateway = gateway;
        this.hairstyles = hairstyles;
        this.inspirations = inspirations;
        this.storage = storage;
        this.processor = processor;
        this.properties = properties;
        this.assets = assets;
        this.slots = slots;
        this.json = json;
        tx = new TransactionTemplate(manager);
    }

    public List<GenerationTaskRow> pending() {
        return !assets.isMaintenance() ? tasks.pending() : List.of();
    }

    private int lease() {
        return Math.max(60, properties.getTimeoutSeconds() * 3 + 120);
    }

    public void execute(GenerationTaskRow candidate) {
        GenerationLog.task(
                candidate.getId(),
                () -> {
                    long started = GenerationLog.started();
                    try {
                        executeTask(candidate);
                    } catch (RuntimeException e) {
                        GenerationLog.failure("task_execution", e, started);
                        throw e;
                    }
                });
    }

    // Serialize new claims through commit in this single-process scheduler. SAVING retains a slot.
    private synchronized boolean claim(GenerationTaskRow candidate, String token) {
        return Boolean.TRUE.equals(
                tx.execute(
                        s -> {
                            files.lockUser(candidate.getUserId());
                            var current = tasks.lock(candidate.getUserId(), candidate.getId());
                            if (current == null
                                    || !Objects.equals(current.getStatus(), candidate.getStatus()))
                                return false;
                            String stage;
                            if ("SAVING".equals(current.getStatus())) {
                                stage = "SAVING";
                            } else if ("QUEUED".equals(current.getStatus())
                                    && tasks.activeCount() < properties.workerCount()) {
                                stage =
                                        "IMAGE".equals(current.getResumeStage())
                                                ? "GENERATING"
                                                : "PLANNING";
                            } else {
                                return false;
                            }
                            if (tasks.claim(
                                            current.getId(),
                                            current.getStatus(),
                                            stage,
                                            token,
                                            lease())
                                    != 1) return false;
                            candidate.setStatus(stage);
                            candidate.setAttemptToken(token);
                            candidate.setCurrentCallId(current.getCurrentCallId());
                            return true;
                        }));
    }

    private void executeTask(GenerationTaskRow candidate) {
        if (assets.isMaintenance()) return;
        String token = UUID.randomUUID().toString();
        if (!claim(candidate, token)) return;
        long started = GenerationLog.started();
        GenerationLog.info(
                "task_claimed",
                "stage={} resumeStage={}",
                candidate.getStatus(),
                candidate.getResumeStage());
        running.put(candidate.getId(), token);
        String stage =
                candidate.getStatus().equals("PLANNING")
                        ? "PLAN"
                        : candidate.getStatus().equals("SAVING") ? "SAVE" : "IMAGE";
        boolean sent = false;
        try {
            if (stage.equals("SAVE")) {
                GenerationLog.info("save_resumed", "");
                save(candidate);
                return;
            }
            var snapshot = service.read(candidate.getInputSnapshot());
            GenerationEngine.requireCurrentSnapshot(snapshot);
            var config =
                    service.credentials(
                            service.read(candidate.getModelConfigSnapshot()),
                            "EVALUATION".equals(snapshot.get("jobKind")));
            var executionBudgets = new LinkedHashMap<>(map(snapshot.get("budgets")));
            for (String key :
                    List.of("planningMaxImages", "imageMaxImages", "maxInputBytes", "maxTextChars"))
                executionBudgets.put(key, config.get(key));
            snapshot.put("budgets", executionBudgets);
            Map<String, Object> output;
            String prompt;
            if (stage.equals("PLAN")) {
                var input = planningImages(candidate, snapshot);
                long waiting = GenerationLog.started();
                GenerationLog.info("plan_slot_wait", "imageCount={}", input.size());
                if (!slots.acquire(true, properties.getTimeoutSeconds() * 1000L))
                    throw new GenerationFailure("PLAN_PROVIDER_FAILED", false);
                GenerationLog.info(
                        "plan_slot_acquired", "elapsedMs={}", GenerationLog.elapsed(waiting));
                long planning = GenerationLog.started();
                try {
                    bindCall(candidate, "PLAN", config);
                    sent = true;
                    GenerationLog.info(
                            "plan_started",
                            "callId={} imageCount={}",
                            candidate.getCurrentCallId(),
                            input.size());
                    output = engine.plan(snapshot, config, input);
                    GenerationLog.info(
                            "plan_validated",
                            "kind={} elapsedMs={}",
                            GenerationLog.label(output.get("kind")),
                            GenerationLog.elapsed(planning));
                    sent = false;
                } finally {
                    slots.release();
                }
                if ("NO_MATCH".equals(output.get("kind"))) {
                    var no = map(output.get("noMatch"));
                    String code =
                            switch (String.valueOf(no.get("reasonCode"))) {
                                case "INCOMPLETE_OUTFIT" -> "OUTFIT_NOT_FEASIBLE";
                                case "PHOTO_INSUFFICIENT" -> "PERSON_PHOTO_INSUFFICIENT";
                                case "REQUIREMENT_CONFLICT" -> "REQUIREMENT_CONFLICT";
                                default -> "HARD_REQUIREMENT_UNMET";
                            };
                    finish(
                            candidate,
                            "FAILED",
                            code,
                            String.valueOf(no.get("message")),
                            "PLAN",
                            "INPUT",
                            true);
                    return;
                }
                if ("EVALUATION".equals(snapshot.get("jobKind"))) {
                    final var evaluation = output;
                    tx.executeWithoutResult(
                            s -> {
                                files.lockUser(candidate.getUserId());
                                requireOwned(candidate);
                                service.savePlan(candidate, snapshot, evaluation, "", true);
                                tasks.finishCall(candidate.getCurrentCallId(), "SUCCEEDED", null);
                                tasks.finish(
                                        candidate.getId(), token, "SUCCEEDED", null, null, null);
                                tasks.release(candidate.getUserId(), candidate.getId());
                                GenerationLog.afterCommit(
                                        candidate.getId(),
                                        "task_finished",
                                        "status=SUCCEEDED stage=PLAN");
                            });
                    return;
                }
                prompt = engine.imagePrompt(snapshot, output) + ImageComposition.prompt(config);
                final var planOutput = output;
                final var imagePrompt = prompt;
                tx.executeWithoutResult(
                        s -> {
                            files.lockUser(candidate.getUserId());
                            requireOwned(candidate);
                            service.savePlan(candidate, snapshot, planOutput, imagePrompt, true);
                            tasks.finishCall(candidate.getCurrentCallId(), "SUCCEEDED", null);
                            tasks.stage(candidate.getId(), token, "GENERATING", null, lease());
                        });
                candidate.setCurrentCallId(null);
                stage = "IMAGE";
            } else {
                var result = tasks.result(candidate.getUserId(), candidate.getId());
                if (result == null) throw new GenerationFailure("PLAN_OUTPUT_INVALID", false);
                output = service.read(String.valueOf(result.get("provenance")));
                prompt = (String) result.get("prompt");
            }
            var imageInput = selectedImages(candidate, snapshot, output);
            Path path = staged(candidate);
            if (!GenerationStaging.hasSpace(properties))
                throw new GenerationFailure("IMAGE_PROVIDER_FAILED", false);
            bindCall(candidate, "IMAGE", config);
            long generating = GenerationLog.started();
            GenerationLog.info(
                    "image_started",
                    "callId={} imageCount={}",
                    candidate.getCurrentCallId(),
                    imageInput.size());
            sent = true;
            byte[] bytes = gateway.generate(config, prompt, imageInput);
            GenerationLog.info(
                    "image_received",
                    "outputBytes={} elapsedMs={}",
                    bytes.length,
                    GenerationLog.elapsed(generating));
            // An image has been returned, but is not recoverable until the atomic file is durable.
            long staging = GenerationLog.started();
            writeDurable(path, bytes, responseLimit(config));
            GenerationLog.info(
                    "image_staged",
                    "outputBytes={} elapsedMs={}",
                    bytes.length,
                    GenerationLog.elapsed(staging));
            sent = false;
            queueSave(candidate, 0, "save_queued");
        } catch (Exception e) {
            GenerationLog.warn(
                    "task_stage_failed",
                    "stage={} code={} exceptionType={} uncertain={} elapsedMs={}",
                    stage,
                    e instanceof GenerationFailure f
                            ? GenerationLog.label(f.getCode())
                            : "UNEXPECTED_ERROR",
                    e.getClass().getSimpleName(),
                    e instanceof GenerationFailure f ? f.isUncertain() : sent,
                    GenerationLog.elapsed(started));
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            if (stage.equals("SAVE") || Files.isRegularFile(staged(candidate))) {
                queueSave(candidate, properties.getSaveRetrySeconds(), "save_deferred");
                return;
            }
            boolean uncertain = e instanceof GenerationFailure f ? f.isUncertain() : sent;
            String code =
                    e instanceof GenerationFailure f
                            ? f.getCode()
                            : stage.equals("PLAN")
                                    ? "PLAN_PROVIDER_FAILED"
                                    : "IMAGE_PROVIDER_FAILED";
            finish(
                    candidate,
                    uncertain ? "UNKNOWN" : "FAILED",
                    uncertain ? "EXTERNAL_RESULT_UNKNOWN" : code,
                    uncertain ? "外部调用结果暂时无法确认，请勿重复提交原任务" : "设计未完成，可查看已有文字方案或按操作提示重试",
                    stage,
                    uncertain ? "UNKNOWN" : "TECHNICAL",
                    false);
        } finally {
            running.remove(candidate.getId(), token);
            GenerationLog.info(
                    "execution_released",
                    "lastStage={} elapsedMs={}",
                    stage,
                    GenerationLog.elapsed(started));
        }
    }

    private void bindCall(GenerationTaskRow row, String stage, Map<String, Object> config) {
        tx.executeWithoutResult(
                s -> {
                    files.lockUser(row.getUserId());
                    requireOwned(row);
                    var c = new HashMap<String, Object>();
                    c.put("user", row.getUserId());
                    c.put("task", row.getId());
                    c.put("stage", stage);
                    c.put(
                            "provider",
                            config.get(stage.equals("PLAN") ? "planProvider" : "imageProvider"));
                    c.put("model", config.get(stage.equals("PLAN") ? "planModel" : "imageModel"));
                    tasks.call(c);
                    row.setCurrentCallId(((Number) c.get("id")).longValue());
                    tasks.stage(
                            row.getId(),
                            row.getAttemptToken(),
                            stage.equals("PLAN") ? "PLANNING" : "GENERATING",
                            row.getCurrentCallId(),
                            lease());
                });
    }

    private List<GenerationGateway.Image> planningImages(
            GenerationTaskRow row, Map<String, Object> snapshot) {
        var refs = new ArrayList<Map<String, Object>>();
        if (snapshot.get("personFileId") != null)
            refs.add(
                    Map.of(
                            "imageId",
                            "person:" + snapshot.get("personFileId"),
                            "fileId",
                            snapshot.get("personFileId")));
        for (var d : list(snapshot.get("candidateItems"))) {
            var images = list(d.get("images"));
            if (images.isEmpty()) throw error(409, "FILE_NOT_USABLE", "衣物图片不可用");
            refs.add(
                    images.stream()
                            .filter(i -> "FRONT".equals(map(i.get("features")).get("viewType")))
                            .findFirst()
                            .orElse(images.getFirst()));
        }
        return resolve(
                row,
                refs,
                map(snapshot.get("budgets")),
                "planningMaxImages",
                map(snapshot.get("hairstyleReference")),
                map(snapshot.get("outfitInspirationReference")));
    }

    private List<GenerationGateway.Image> selectedImages(
            GenerationTaskRow row, Map<String, Object> snapshot, Map<String, Object> output) {
        var refs = new ArrayList<Map<String, Object>>();
        refs.add(
                Map.of(
                        "imageId",
                        "person:" + snapshot.get("personFileId"),
                        "fileId",
                        snapshot.get("personFileId")));
        for (var item : list(map(output.get("plan")).get("items"))) {
            var dress =
                    list(snapshot.get("candidateItems")).stream()
                            .filter(d -> d.get("dressId").equals(item.get("dressId")))
                            .findFirst()
                            .orElseThrow();
            for (Object iid : (List<?>) item.get("referenceImageIds"))
                refs.add(
                        list(dress.get("images")).stream()
                                .filter(i -> i.get("imageId").equals(iid))
                                .findFirst()
                                .orElseThrow());
        }
        return resolve(
                row,
                refs,
                map(snapshot.get("budgets")),
                "imageMaxImages",
                map(snapshot.get("hairstyleReference")),
                Map.of());
    }

    private List<GenerationGateway.Image> resolve(
            GenerationTaskRow row,
            List<Map<String, Object>> refs,
            Map<String, Object> budget,
            String key,
            Map<String, Object> hairstyle,
            Map<String, Object> inspiration) {
        var catalogImages = new ArrayList<>(hairstyles.references(hairstyle));
        catalogImages.addAll(inspirations.references(inspiration));
        if (refs.size() + catalogImages.size() > ((Number) budget.get(key)).intValue())
            throw error(422, "INPUT_BUDGET_EXCEEDED", "图片数量超过预算");
        long total = catalogImages.stream().mapToLong(image -> image.getBytes().length).sum();
        if (total > ((Number) budget.get("maxInputBytes")).longValue())
            throw error(422, "INPUT_BUDGET_EXCEEDED", "图片大小超过预算");
        var result = new ArrayList<GenerationGateway.Image>();
        for (var ref : refs) {
            var f = service.retained(row.getUserId(), id(ref.get("fileId")), false);
            total = Math.addExact(total, f.getSizeBytes());
            if (total > ((Number) budget.get("maxInputBytes")).longValue())
                throw error(422, "INPUT_BUDGET_EXCEEDED", "图片大小超过预算");
            result.add(
                    new GenerationGateway.Image(
                            (String) ref.get("imageId"),
                            storage.signedUrl(
                                    f.getBucket(),
                                    f.getStorageKey(),
                                    Math.max(300, properties.getTimeoutSeconds() + 60))));
        }
        result.addAll(catalogImages);
        return result;
    }

    private Path staged(GenerationTaskRow row) {
        return GenerationStaging.directory(properties)
                .resolve(row.getUserId() + "-" + row.getId() + ".image");
    }

    // Older snapshots without an explicit response budget still obey the fixed image validation
    // limit.
    private static int responseLimit(Map<String, Object> config) {
        var value = config.get("maxResponseBytes");
        return value instanceof Number limit ? limit.intValue() : GeneratedImageValidator.MAX_BYTES;
    }

    private void writeDurable(Path path, byte[] bytes, int responseLimit) throws IOException {
        if (bytes.length == 0 || bytes.length > responseLimit)
            throw new IOException("Output image exceeds budget");
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        try (var channel =
                FileChannel.open(
                        temporary,
                        StandardOpenOption.CREATE,
                        StandardOpenOption.TRUNCATE_EXISTING,
                        StandardOpenOption.WRITE)) {
            var buffer = ByteBuffer.wrap(bytes);
            while (buffer.hasRemaining()) channel.write(buffer);
            channel.force(true);
        }
        Files.move(
                temporary,
                path,
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING);
        try (var dir = FileChannel.open(path.getParent(), StandardOpenOption.READ)) {
            dir.force(true);
        }
    }

    private void save(GenerationTaskRow row) throws Exception {
        long started = GenerationLog.started();
        GenerationLog.info("save_started", "");
        Path path = staged(row);
        if (!Files.isRegularFile(path)) {
            finish(
                    row,
                    "FAILED",
                    "RESULT_SAVE_FAILED",
                    "暂存结果已丢失，无法恢复保存",
                    "SAVE",
                    "TECHNICAL",
                    false);
            return;
        }
        GeneratedImageValidator.Validated image;
        try {
            var limit =
                    Math.min(
                            responseLimit(service.read(row.getModelConfigSnapshot())),
                            GeneratedImageValidator.MAX_BYTES);
            if (Files.size(path) > limit) throw new InvalidImageException("图片超过大小限制");
            image = processor.validate(Files.readAllBytes(path));
        } catch (InvalidImageException invalid) {
            finish(row, "FAILED", "RESULT_SAVE_FAILED", "供应商返回的图片无法读取", "SAVE", "TECHNICAL", false);
            Files.deleteIfExists(path);
            return;
        }
        String extension =
                switch (image.mimeType()) {
                    case "image/png" -> ".png";
                    case "image/webp" -> ".webp";
                    default -> ".jpg";
                };
        String key = "generated/" + row.getUserId() + "/" + row.getId() + "-original" + extension;
        long uploading = GenerationLog.started();
        GenerationLog.info("storage_save_started", "outputBytes={}", image.bytes().length);
        putIfDifferent(key, image.bytes(), image.mimeType());
        GenerationLog.info(
                "storage_save_completed", "elapsedMs={}", GenerationLog.elapsed(uploading));
        tx.executeWithoutResult(
                s -> {
                    files.lockUser(row.getUserId());
                    requireOwned(row);
                    var file = new FileAssetRow();
                    file.setUserId(row.getUserId());
                    file.setBucket(storage.bucket());
                    file.setStorageKey(key);
                    file.setMimeType(image.mimeType());
                    file.setSizeBytes((long) image.bytes().length);
                    file.setWidth(image.width());
                    file.setHeight(image.height());
                    if (row.getCurrentCallId() != null)
                        tasks.finishStagedImageCall(
                                row.getUserId(), row.getId(), row.getCurrentCallId());
                    tasks.output(file);
                    tasks.asset(
                            row.getUserId(), row.getId(), file.getId(), "OUTPUT", null, null, 0);
                    tasks.finish(row.getId(), row.getAttemptToken(), "SUCCEEDED", null, null, null);
                    tasks.release(row.getUserId(), row.getId());
                    GenerationLog.afterCommit(
                            row.getId(),
                            "task_finished",
                            "status=SUCCEEDED stage=SAVE outputBytes={} elapsedMs={}",
                            image.bytes().length,
                            GenerationLog.elapsed(started));
                });
        Files.deleteIfExists(path);
    }

    private void putIfDifferent(String key, byte[] bytes, String mime) throws Exception {
        try {
            if (java.security.MessageDigest.isEqual(
                    storage.read(storage.bucket(), key, bytes.length), bytes)) return;
        } catch (Exception unavailable) {
            /* A missing/unreadable object is replaced at the same stable key. */
        }
        storage.put(storage.bucket(), key, bytes, mime);
    }

    public void renew() {
        for (var entry : running.entrySet()) tasks.renew(entry.getKey(), entry.getValue(), lease());
    }

    private static boolean owned(GenerationTaskRow row, GenerationTaskRow current) {
        return current != null
                && Objects.equals(row.getAttemptToken(), current.getAttemptToken())
                && Set.of("PLANNING", "GENERATING", "SAVING").contains(current.getStatus());
    }

    private void requireOwned(GenerationTaskRow row) {
        if (!owned(row, tasks.lock(row.getUserId(), row.getId())))
            throw new IllegalStateException("Generation execution ownership changed");
    }

    private void finish(
            GenerationTaskRow row,
            String status,
            String code,
            String message,
            String stage,
            String category,
            boolean validCall) {
        tx.executeWithoutResult(
                s -> {
                    files.lockUser(row.getUserId());
                    var current = tasks.lock(row.getUserId(), row.getId());
                    if (!owned(row, current)) {
                        GenerationLog.task(
                                row.getId(),
                                () -> GenerationLog.info("task_ownership_lost", "stage={}", stage));
                        return;
                    }
                    String action =
                            status.equals("UNKNOWN")
                                    ? "REFRESH"
                                    : category.equals("INPUT")
                                            ? "EDIT_INPUT"
                                            : tasks.result(row.getUserId(), row.getId()) != null
                                                    ? "RETRY_IMAGE"
                                                    : "RETRY_FULL";
                    String outcome =
                            json.writeValueAsString(
                                    Map.of(
                                            "schemaVersion",
                                            1,
                                            "stage",
                                            stage,
                                            "category",
                                            category,
                                            "code",
                                            code,
                                            "message",
                                            message,
                                            "suggestedAction",
                                            action));
                    tasks.finish(
                            row.getId(), row.getAttemptToken(), status, code, message, outcome);
                    tasks.release(row.getUserId(), row.getId());
                    GenerationLog.afterCommit(
                            row.getId(),
                            "task_finished",
                            "status={} stage={} code={}",
                            status,
                            stage,
                            code);
                    if (current.getCurrentCallId() != null)
                        tasks.finishCall(
                                current.getCurrentCallId(),
                                validCall ? "SUCCEEDED" : status,
                                validCall ? null : code);
                });
    }

    private void queueSave(GenerationTaskRow row, int delaySeconds, String event) {
        tx.executeWithoutResult(
                s -> {
                    files.lockUser(row.getUserId());
                    var current = tasks.lock(row.getUserId(), row.getId());
                    if (!owned(row, current)) {
                        GenerationLog.info("task_ownership_lost", "stage=SAVE");
                        return;
                    }
                    // The atomic staging file proves the IMAGE response arrived, including after a
                    // crash.
                    if (current.getCurrentCallId() != null
                            && "GENERATING".equals(current.getStatus())) {
                        tasks.finishStagedImageCall(
                                row.getUserId(), row.getId(), current.getCurrentCallId());
                    }
                    tasks.deferSave(row.getId(), row.getAttemptToken(), delaySeconds);
                    GenerationLog.afterCommit(
                            row.getId(), event, "retryAfterSeconds={}", delaySeconds);
                });
    }

    public void recover() {
        if (assets.isMaintenance()) return;
        for (var row : tasks.expired()) {
            if (running.containsKey(row.getId())) continue;
            GenerationLog.task(
                    row.getId(),
                    () -> GenerationLog.info("recovery_started", "status={}", row.getStatus()));
            if (Files.isRegularFile(staged(row))) {
                queueSave(row, 0, "save_recovery_queued");
            } else if ("SAVING".equals(row.getStatus()))
                finish(
                        row,
                        "FAILED",
                        "RESULT_SAVE_FAILED",
                        "暂存结果已丢失，无法恢复保存",
                        "SAVE",
                        "TECHNICAL",
                        false);
            else
                finish(
                        row,
                        row.getCurrentCallId() == null ? "FAILED" : "UNKNOWN",
                        row.getCurrentCallId() == null
                                ? "PLAN_PROVIDER_FAILED"
                                : "EXTERNAL_RESULT_UNKNOWN",
                        "服务中断，原调用不会自动重发",
                        row.getStatus().equals("PLANNING") ? "PLAN" : "IMAGE",
                        row.getCurrentCallId() == null ? "TECHNICAL" : "UNKNOWN",
                        false);
        }
    }
}
