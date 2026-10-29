package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.PreferenceParameters;
import cc.riskswap.lookmate.common.util.GenerationLog;
import cc.riskswap.lookmate.common.util.ImageComposition;
import cc.riskswap.lookmate.config.*;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.integration.ai.ModelProtocols;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Submission boundary. All association changes use the account lock; no remote calls here. */
@Service
public class GenerationService {
    private final GenerationMapper tasks;
    private final ProfileMapper profiles;
    private final PreferenceMapper preferences;
    private final DressMapper dresses;
    private final FileMapper files;
    private final GenerationProperties properties;
    private final AssetProperties assets;
    private final ObjectStorage storage;
    private final GenerationEngine engine;
    private final HairstyleCatalogService hairstyles;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final Object admission = new Object();

    public GenerationService(
            GenerationMapper tasks,
            ProfileMapper profiles,
            PreferenceMapper preferences,
            DressMapper dresses,
            FileMapper files,
            GenerationProperties properties,
            AssetProperties assets,
            ObjectStorage storage,
            GenerationEngine engine,
            ObjectMapper json,
            PlatformTransactionManager manager,
            HairstyleCatalogService hairstyles) {
        this.tasks = tasks;
        this.profiles = profiles;
        this.preferences = preferences;
        this.dresses = dresses;
        this.files = files;
        this.properties = properties;
        this.assets = assets;
        this.storage = storage;
        this.engine = engine;
        this.hairstyles = hairstyles;
        this.json = json;
        tx = new TransactionTemplate(manager);
    }

    public void requireAvailable() {
        requireAvailable(false);
    }

    public void requireAvailable(boolean evaluation) {
        if (assets.isMaintenance()
                || !storage.available()
                || (!evaluation && properties.getPreviewSecret().length() < 32)
                || properties.getPlanProvider().isBlank()
                || !ModelProtocols.CHAT.equals(properties.getPlanProtocol())
                || !ModelProtocols.validEndpoint(properties.getPlanEndpoint())
                || properties.getPlanModel().isBlank()
                || properties.getPlanApiKey().isBlank()
                || (!evaluation
                        && (properties.getImageProvider().isBlank()
                                || !ModelProtocols.imageSupported(properties.getImageProtocol())
                                || !ModelProtocols.validEndpoint(properties.getImageEndpoint())
                                || properties.getImageModel().isBlank()
                                || properties.getImageApiKey().isBlank()
                                || properties.getImageEndpoint().isBlank()))
                || properties.getPlanningMaxImages() < 1
                || (!evaluation && properties.getImageMaxImages() < 1)
                || properties.getMaxInputBytes() < 1
                || properties.getMaxTextChars() < 1)
            throw error(503, "GENERATION_UNAVAILABLE", "设计生成尚未配置或暂不可用");
    }

    private int effectiveImageMaxImages() {
        return ModelProtocols.SILICONFLOW_IMAGES.equals(properties.getImageProtocol())
                ? Math.min(1, properties.getImageMaxImages())
                : properties.getImageMaxImages();
    }

    private void requireImageCapability(Map<String, Object> input) {
        if (ModelProtocols.SILICONFLOW_IMAGES.equals(properties.getImageProtocol())
                && (!"HAIRSTYLE".equals(input.get("designType"))
                        || input.get("hairstyleId") != null))
            throw error(
                    503,
                    "GENERATION_UNAVAILABLE",
                    input.get("hairstyleId") == null
                            ? "当前生图协议仅支持一张参考图，无法同时保留本人和衣物图片"
                            : "当前生图协议仅支持一张参考图，无法同时保留本人和发型参考图片");
    }

    public Map<String, Object> budgets() {
        return Map.of(
                "candidateTarget",
                properties.getCandidateTarget(),
                "planningMaxImages",
                properties.getPlanningMaxImages(),
                "imageMaxImages",
                effectiveImageMaxImages(),
                "maxInputBytes",
                properties.getMaxInputBytes(),
                "maxTextChars",
                properties.getMaxTextChars());
    }

    public Map<String, Object> configuration() {
        var c = new LinkedHashMap<String, Object>();
        c.put("planProvider", properties.getPlanProvider());
        c.put("planProtocol", properties.getPlanProtocol());
        c.put("imageProvider", properties.getImageProvider());
        c.put("imageProtocol", properties.getImageProtocol());
        c.put("planEndpoint", properties.getPlanEndpoint());
        c.put("planModel", properties.getPlanModel());
        c.put("imageEndpoint", properties.getImageEndpoint());
        c.put("imageModel", properties.getImageModel());
        c.put("imageParameters", properties.getImageParameters());
        c.put("timeoutSeconds", properties.getTimeoutSeconds());
        c.put("maxResponseBytes", properties.getMaxResponseBytes());
        c.putAll(budgets());
        c.put("promptVersion", "generation-v1");
        return c;
    }

    public Map<String, Object> configuration(String designType) {
        return ImageComposition.configure(
                configuration(), properties.getImageSizesByType(), designType);
    }

    public Map<String, Object> credentials(Map<String, Object> saved) {
        return credentials(saved, false);
    }

    public Map<String, Object> credentials(Map<String, Object> saved, boolean evaluation) {
        var c = new LinkedHashMap<>(saved);
        // Missing protocol identifies pre-switch snapshots, never the new default.
        c.putIfAbsent("planProtocol", ModelProtocols.CHAT);
        c.putIfAbsent("imageProtocol", ModelProtocols.EDITS);
        c.putIfAbsent("planProvider", "DeepSeek");
        c.putIfAbsent("imageProvider", "configured-image");
        if (!ModelProtocols.CHAT.equals(c.get("planProtocol"))
                || (!evaluation
                        && !ModelProtocols.imageSupported(String.valueOf(c.get("imageProtocol")))))
            throw error(503, "GENERATION_UNAVAILABLE", "原模型协议不可用");
        String pm = String.valueOf(c.get("planModel")), im = String.valueOf(c.get("imageModel"));
        String pk =
                pm.equals(properties.getPlanModel())
                                && Objects.equals(
                                        c.get("planEndpoint"), properties.getPlanEndpoint())
                        ? properties.getPlanApiKey()
                        : properties.getPlanCredentials().get(c.get("planEndpoint") + "|" + pm);
        String ik =
                im.equals(properties.getImageModel())
                                && Objects.equals(
                                        c.get("imageEndpoint"), properties.getImageEndpoint())
                        ? properties.getImageApiKey()
                        : properties.getImageCredentials().get(c.get("imageEndpoint") + "|" + im);
        if (pk == null || pk.isBlank() || (!evaluation && (ik == null || ik.isBlank())))
            throw error(503, "GENERATION_UNAVAILABLE", "原模型配置凭据不可用");
        c.put("planApiKey", pk);
        if (!evaluation) c.put("imageApiKey", ik);
        return c;
    }

    public Map<String, Object> preview(Long user, Map<String, Object> body) {
        return GenerationLog.operation("preview", () -> previewObserved(user, body));
    }

    private Map<String, Object> previewObserved(Long user, Map<String, Object> body) {
        var input = normalize(body);
        requireAvailable();
        requireImageCapability(input);
        return tx.execute(
                s -> {
                    profiles.lockUser(user);
                    var snapshot = context(user, input, false, 0);
                    var summary = map(snapshot.get("inputSummary"));
                    String digest = digest(input);
                    String contextDigest = digest(summary);
                    long expires = Instant.now().getEpochSecond() + properties.getPreviewSeconds();
                    var tokenBody =
                            Map.of(
                                    "user",
                                    user.toString(),
                                    "input",
                                    digest,
                                    "context",
                                    contextDigest,
                                    "expires",
                                    expires,
                                    "date",
                                    LocalDate.now(ZoneId.of("Asia/Shanghai")).toString());
                    String payload =
                            Base64.getUrlEncoder()
                                    .withoutPadding()
                                    .encodeToString(json.writeValueAsBytes(tokenBody));
                    var result = new LinkedHashMap<>(summary);
                    result.remove("request");
                    var safeRequired = new ArrayList<Map<String, Object>>();
                    for (var d : list(result.get("requiredDresses"))) {
                        var safe = new LinkedHashMap<>(d);
                        safe.remove("snapshotDigest");
                        safeRequired.add(safe);
                    }
                    result.put("requiredDresses", safeRequired);
                    var conflicts = list(snapshot.get("previewConflicts"));
                    result.put("canSubmit", conflicts.isEmpty());
                    result.put(
                            "previewToken",
                            conflicts.isEmpty() ? payload + "." + sign(payload) : null);
                    result.put("expiresAt", Instant.ofEpochSecond(expires).toString());
                    result.put("inputDigest", digest);
                    result.put("conflicts", conflicts);
                    result.put("restrictions", snapshot.get("restrictions"));
                    result.put("notices", List.of());
                    result.put("semanticCheck", "NOT_EXHAUSTIVE");
                    result.put(
                            "limits",
                            Map.of(
                                    "maxRequiredDressCount",
                                    Math.max(
                                            0,
                                            Math.min(
                                                            properties.getPlanningMaxImages(),
                                                            properties.getImageMaxImages())
                                                    - 1)));
                    GenerationLog.info(
                            "preview_ready",
                            "canSubmit={} conflictCount={} candidateCount={}",
                            conflicts.isEmpty(),
                            conflicts.size(),
                            list(snapshot.get("candidateItems")).size());
                    return result;
                });
    }

    public Map<String, Object> submit(Long user, String key, Map<String, Object> body) {
        return GenerationLog.operation("submit", () -> submitObserved(user, key, body));
    }

    private Map<String, Object> submitObserved(Long user, String key, Map<String, Object> body) {
        fields(body, Set.of("input", "previewToken"));
        if (!(body.get("input") instanceof Map<?, ?>)) throw invalid();
        var input = normalize(map(body.get("input")));
        validateKey(key);
        String hash = digest(Map.of("operation", "CREATE", "input", input));
        synchronized (admission) {
            return tx.execute(
                    s -> {
                        profiles.lockUser(user);
                        var existing = replay(user, key, hash);
                        if (existing != null) return response(existing);
                        requireAvailable();
                        var snapshot = context(user, input, true, new SecureRandom().nextLong());
                        if (!list(snapshot.get("previewConflicts")).isEmpty())
                            throw error(409, "REQUIREMENT_CONFLICT", "本次设计与长期限制冲突，请确认例外");
                        checkToken(
                                user,
                                input,
                                map(snapshot.get("inputSummary")),
                                body.get("previewToken"));
                        checkCapacity(user);
                        var row = new GenerationTaskRow();
                        row.setUserId(user);
                        row.setDesignType((String) input.get("designType"));
                        row.setClientRequestId(key);
                        row.setRequestHash(hash);
                        row.setInputSnapshot(json.writeValueAsString(snapshot));
                        row.setModelConfigSnapshot(
                                json.writeValueAsString(configuration(row.getDesignType())));
                        row.setResumeStage("PLAN");
                        tasks.insert(row);
                        bindSnapshot(row, snapshot);
                        tasks.active(user, row.getId());
                        row.setStatus("QUEUED");
                        GenerationLog.afterCommit(
                                row.getId(),
                                "task_queued",
                                "designType={} resumeStage={} retryOfTaskId={}",
                                row.getDesignType(),
                                row.getResumeStage(),
                                row.getRetryOfTaskId());
                        return response(row);
                    });
        }
    }

    /** Fixed outfit submission shares admission, account lock and the durable design queue. */
    public Map<String, Object> submitOutfit(
            Long user,
            String key,
            String hash,
            String kind,
            java.util.function.Supplier<Map<String, Object>> snapshotSupplier,
            java.util.function.Consumer<GenerationTaskRow> link) {
        validateKey(key);
        synchronized (admission) {
            return tx.execute(
                    s -> {
                        profiles.lockUser(user);
                        var replay = replay(user, key, hash);
                        if (replay != null) return response(replay);
                        requireAvailable("EVALUATION".equals(kind));
                        var snapshot = snapshotSupplier.get();
                        checkCapacity(user);
                        var row = new GenerationTaskRow();
                        row.setUserId(user);
                        row.setDesignType("OUTFIT");
                        row.setClientRequestId(key);
                        row.setRequestHash(hash);
                        row.setInputSnapshot(json.writeValueAsString(snapshot));
                        row.setModelConfigSnapshot(
                                json.writeValueAsString(configuration(row.getDesignType())));
                        row.setResumeStage("PLAN");
                        tasks.insert(row);
                        bindSnapshot(row, snapshot);
                        link.accept(row);
                        tasks.active(user, row.getId());
                        row.setStatus("QUEUED");
                        GenerationLog.afterCommit(
                                row.getId(),
                                "task_queued",
                                "designType={} resumeStage={} retryOfTaskId={}",
                                row.getDesignType(),
                                row.getResumeStage(),
                                row.getRetryOfTaskId());
                        return response(row);
                    });
        }
    }

    public Map<String, Object> byKey(Long user, String key) {
        validateKey(key);
        var row = tasks.byKey(user, key);
        if (row == null || row.getHiddenAt() != null)
            throw error(404, "DESIGN_REQUEST_NOT_FOUND", "没有找到这次提交");
        return response(row);
    }

    private GenerationTaskRow replay(Long user, String key, String hash) {
        var row = tasks.byKey(user, key);
        if (row != null && row.getHiddenAt() != null)
            throw error(409, "DESIGN_REQUEST_HIDDEN", "原提交已隐藏，请使用新的提交键");
        if (row != null && !hash.equals(row.getRequestHash()))
            throw error(409, "IDEMPOTENCY_CONFLICT", "提交键对应不同输入");
        if (row != null)
            GenerationLog.afterCommit(
                    row.getId(), "submission_replayed", "status={}", row.getStatus());
        return row;
    }

    private void checkCapacity(Long user) {
        if (tasks.userPending(user) > 0) throw error(409, "ACTIVE_TASK_EXISTS", "已有进行中的设计，请先查看结果");
        if (tasks.pendingCount() >= properties.getPendingLimit())
            throw error(503, "TASK_CAPACITY_EXCEEDED", "设计队列已满，请稍后再试");
    }

    public Map<String, Object> retry(Long user, String id, String key, Map<String, Object> body) {
        return GenerationLog.operation("retry", () -> retry(user, id, key, body, false, row -> {}));
    }

    public Map<String, Object> retryOutfit(
            Long user,
            String id,
            String key,
            Map<String, Object> body,
            java.util.function.Consumer<GenerationTaskRow> link) {
        return GenerationLog.operation(
                "retry_outfit", () -> retry(user, id, key, body, true, link));
    }

    private Map<String, Object> retry(
            Long user,
            String id,
            String key,
            Map<String, Object> body,
            boolean outfit,
            java.util.function.Consumer<GenerationTaskRow> link) {
        fields(body, Set.of("mode"));
        String mode = String.valueOf(body.get("mode"));
        if (!Set.of("FULL", "IMAGE_ONLY").contains(mode)) throw invalid();
        Long source = id(id);
        validateKey(key);
        String hash = digest(Map.of("operation", "RETRY", "source", id, "mode", mode));
        synchronized (admission) {
            return tx.execute(
                    s -> {
                        profiles.lockUser(user);
                        var replay = replay(user, key, hash);
                        if (replay != null) return response(replay);
                        var old = tasks.lock(user, source);
                        if (old == null || old.getHiddenAt() != null)
                            throw error(404, "DESIGN_NOT_FOUND", "设计记录不存在");
                        if (!"FAILED".equals(old.getStatus()) || isInputFailure(old.getErrorCode()))
                            throw error(409, "ACTION_NOT_ALLOWED", "当前任务不能原样重试");
                        var snapshot = read(old.getInputSnapshot());
                        boolean fixed = Boolean.TRUE.equals(snapshot.get("fixedOutfit"));
                        if (outfit != fixed) throw error(409, "ACTION_NOT_ALLOWED", "请通过对应搭配入口重试");
                        boolean evaluation = "EVALUATION".equals(snapshot.get("jobKind"));
                        requireAvailable(evaluation);
                        if (evaluation && mode.equals("IMAGE_ONLY"))
                            throw error(409, "ACTION_NOT_ALLOWED", "文字评价不能重试生图");
                        if (!Integer.valueOf(2).equals(snapshot.get("schemaVersion")))
                            throw error(409, "RETRY_INPUT_UNAVAILABLE", "原输入快照不可用");
                        var result = tasks.result(user, source);
                        if (mode.equals("IMAGE_ONLY") && result == null)
                            throw error(409, "ACTION_NOT_ALLOWED", "没有可复用的文字方案");
                        var refs = tasks.assets(user, source);
                        for (var ref : refs)
                            if (!"OUTPUT".equals(ref.get("role")))
                                retained(user, ((Number) ref.get("assetId")).longValue(), true);
                        validateRetryBudget(snapshot, result, mode, user);
                        checkCapacity(user);
                        var row = new GenerationTaskRow();
                        row.setUserId(user);
                        row.setDesignType(old.getDesignType());
                        row.setClientRequestId(key);
                        row.setRequestHash(hash);
                        row.setInputSnapshot(old.getInputSnapshot());
                        row.setModelConfigSnapshot(
                                json.writeValueAsString(
                                        ImageComposition.retry(
                                                configuration(),
                                                read(old.getModelConfigSnapshot()))));
                        row.setRetryOfTaskId(source);
                        row.setRetrySourceId(
                                !"IMAGE".equals(old.getResumeStage())
                                                || old.getRetrySourceId() == null
                                        ? source
                                        : old.getRetrySourceId());
                        row.setResumeStage(mode.equals("IMAGE_ONLY") ? "IMAGE" : "PLAN");
                        tasks.insert(row);
                        for (var ref : refs)
                            if (!"OUTPUT".equals(ref.get("role"))
                                    && (!"DRESS".equals(ref.get("role"))
                                            || mode.equals("IMAGE_ONLY")))
                                tasks.asset(
                                        user,
                                        row.getId(),
                                        ((Number) ref.get("assetId")).longValue(),
                                        (String) ref.get("role"),
                                        number(ref.get("dressId")),
                                        number(ref.get("imageId")),
                                        ((Number) ref.get("position")).intValue());
                        if (mode.equals("IMAGE_ONLY"))
                            savePlan(
                                    row,
                                    snapshot,
                                    read(String.valueOf(result.get("provenance"))),
                                    (String) result.get("prompt"),
                                    false);
                        link.accept(row);
                        tasks.active(user, row.getId());
                        row.setStatus("QUEUED");
                        GenerationLog.afterCommit(
                                row.getId(),
                                "task_queued",
                                "designType={} resumeStage={} retryOfTaskId={}",
                                row.getDesignType(),
                                row.getResumeStage(),
                                row.getRetryOfTaskId());
                        return response(row);
                    });
        }
    }

    public static boolean isInputFailure(String code) {
        return Set.of(
                        "OUTFIT_NOT_FEASIBLE",
                        "HARD_REQUIREMENT_UNMET",
                        "REQUIREMENT_CONFLICT",
                        "PERSON_PHOTO_INSUFFICIENT")
                .contains(code == null ? "" : code);
    }

    private Map<String, Object> context(
            Long user, Map<String, Object> input, boolean select, long seed) {
        requireImageCapability(input);
        var profile = profiles.profile(user);
        if (profile == null) throw error(404, "RESOURCE_NOT_FOUND", "资料不存在");
        if (!profile.getVersion().toString().equals(input.get("profileVersion")))
            throw error(409, "PROFILE_CHANGED", "个人资料已改变，请重新预览");
        var personFile = usable(user, id(input.get("personFileId")), false);
        Map<String, Object> hairstyle =
                input.get("hairstyleId") == null
                        ? null
                        : hairstyles.select(
                                (String) input.get("hairstyleId"),
                                (String) input.get("hairstyleVersion"));
        if (hairstyle != null) {
            int count = list(hairstyle.get("images")).size() + 1;
            if (count > properties.getPlanningMaxImages()
                    || count > effectiveImageMaxImages()
                    || hairstyles.referenceBytes(hairstyle) + personFile.getSizeBytes()
                            > properties.getMaxInputBytes())
                throw error(422, "INPUT_BUDGET_EXCEEDED", "本人照片和发型参考图超过当前图片预算");
        }
        var inputBudgets = new LinkedHashMap<>(budgets());
        inputBudgets.put("personImageBytes", personFile.getSizeBytes());
        var preferenceRow = preferences.get(user);
        var prefs = PreferenceParameters.values(preferenceRow);
        var personal = new LinkedHashMap<String, Object>();
        personal.put("profileVersion", profile.getVersion().toString());
        personal.put("gender", profile.getGender());
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        personal.put(
                "age",
                profile.getBirthDate() == null
                        ? null
                        : Period.between(profile.getBirthDate(), today).getYears());
        personal.put("ageAsOf", today.toString());
        personal.put("preferences", preferenceRow == null ? null : prefs);
        MeasurementRow measurement = null;
        if (Boolean.TRUE.equals(input.get("useMeasurements"))) {
            Long mid =
                    input.get("measurementId") == null
                            ? profile.getCurrentMeasurementId()
                            : id(input.get("measurementId"));
            if (mid != null) {
                measurement = profiles.measurement(user, mid);
                if (measurement == null) throw error(404, "RESOURCE_NOT_FOUND", "尺寸记录不存在");
            }
        }
        Map<String, Object> measures =
                measurement == null ? null : json.convertValue(measurement, Map.class);
        if (measures != null) {
            for (String k : List.of("id", "userId", "recordKind", "createdAt", "updatedAt"))
                measures.remove(k);
            if (measures.values().stream().allMatch(Objects::isNull)) measures = null;
        }
        personal.put("measurements", measures);
        personal.put("measurementId", measurement == null ? null : measurement.getId().toString());
        personal.put("measurementState", measures == null ? "NONE" : "AVAILABLE");
        personal.put("measurementUnits", Map.of("length", "cm", "weight", "kg"));
        List<Map<String, Object>> restrictions = new ArrayList<>();
        String type = (String) input.get("designType");
        var labels =
                Map.of(
                        "NO_HIGH_HEELS",
                        "不穿高跟鞋",
                        "NO_MIDRIFF",
                        "不露腰腹",
                        "NO_TIGHT",
                        "不穿紧身款",
                        "NO_SHORTENING",
                        "不剪短头发");
        for (Object value : (List<?>) prefs.get("restrictions")) {
            String code = (String) value;
            if (type.equals("HAIRSTYLE") && !code.equals("NO_SHORTENING")
                    || type.equals("OUTFIT") && code.equals("NO_SHORTENING")) continue;
            restrictions.add(new LinkedHashMap<>(Map.of("id", code, "text", labels.get(code))));
        }
        if (!type.equals("OUTFIT")) {
            if ("REJECT".equals(prefs.get("dyeAcceptance")))
                restrictions.add(new LinkedHashMap<>(Map.of("id", "DYE_REJECT", "text", "不染发")));
            if ("REJECT".equals(prefs.get("permAcceptance")))
                restrictions.add(new LinkedHashMap<>(Map.of("id", "PERM_REJECT", "text", "不烫发")));
        }
        if (prefs.get("restrictionNote") instanceof String note && !note.isBlank())
            restrictions.add(
                    new LinkedHashMap<>(
                            Map.of("id", "restrictionNote:" + sha(note), "text", note)));
        var overrides = (List<String>) input.get("constraintOverrides");
        var allowed = new HashSet<String>();
        restrictions.forEach(r -> allowed.add((String) r.get("id")));
        if (!allowed.containsAll(overrides)) throw invalid();
        List<Map<String, Object>> effective = new ArrayList<>(), exceptions = new ArrayList<>();
        for (var r : restrictions) {
            boolean override = overrides.contains(r.get("id"));
            r.put("overridden", override);
            if (!override) effective.add(Map.of("id", r.get("id"), "text", r.get("text")));
            else exceptions.add(Map.of("id", r.get("id"), "originalText", r.get("text")));
        }
        List<String> required = (List<String>) input.get("requiredDressIds");
        if (required.size() + 1
                > Math.min(properties.getPlanningMaxImages(), properties.getImageMaxImages()))
            throw error(422, "INPUT_BUDGET_EXCEEDED", "必穿单品数量超过图片预算");
        var conflicts = new ArrayList<Map<String, Object>>();
        if (Boolean.TRUE.equals(input.get("useReferenceHairColor"))
                && effective.stream().anyMatch(c -> "DYE_REJECT".equals(c.get("id"))))
            conflicts.add(
                    Map.of(
                            "restrictionId",
                            "DYE_REJECT",
                            "requirementExcerpt",
                            "同时尝试参考发色",
                            "message",
                            "参考发色与不染发的长期限制冲突，请确认仅本次允许或保留本人发色"));
        var wardrobe = wardrobe(user, select && !type.equals("HAIRSTYLE") ? null : required);
        List<Map<String, Object>> requiredDresses = new ArrayList<>();
        for (String rid : required) {
            var dress =
                    wardrobe.stream()
                            .filter(d -> rid.equals(d.get("dressId")))
                            .findFirst()
                            .orElseThrow(() -> error(409, "REQUIRED_DRESS_UNAVAILABLE", "必穿单品不可用"));
            if (effective.stream().anyMatch(c -> "NO_TIGHT".equals(c.get("id")))
                    && list(dress.get("images")).stream()
                            .anyMatch(i -> "SLIM".equals(i.get("manualFit"))))
                conflicts.add(
                        Map.of(
                                "restrictionId",
                                "NO_TIGHT",
                                "requirementExcerpt",
                                "必穿：" + dress.get("name"),
                                "message",
                                "必穿单品的人工版型为修身，与不穿紧身衣的限制冲突，请确认例外或更换单品"));
            requiredDresses.add(
                    Map.of(
                            "dressId",
                            rid,
                            "dressName",
                            dress.get("name"),
                            "categoryName",
                            dress.get("categoryName"),
                            "imageFileIds",
                            list(dress.get("images")).stream().map(i -> i.get("fileId")).toList(),
                            "snapshotDigest",
                            digest(dress)));
        }
        var summary = new LinkedHashMap<String, Object>();
        summary.put("schemaVersion", 2);
        var request = new LinkedHashMap<>(input);
        request.remove("profileVersion");
        request.remove("personFileId");
        request.remove("constraintOverrides");
        summary.put("request", request);
        summary.put("personPhoto", Map.of("fileId", input.get("personFileId")));
        summary.put("personalContext", personal);
        summary.put("requiredDresses", requiredDresses);
        summary.put("constraintOverrides", exceptions);
        if (hairstyle != null) summary.put("hairstyleReference", hairstyle);
        List<Map<String, Object>> candidates = List.of();
        if (select && !type.equals("HAIRSTYLE")) {
            if (wardrobe.isEmpty()) throw error(422, "WARDROBE_EMPTY", "请先添加可用衣物");
            try {
                candidates = engine.selectCandidates(wardrobe, required, prefs, seed, inputBudgets);
            } catch (cc.riskswap.lookmate.integration.ai.GenerationFailure failure) {
                throw error(422, failure.getCode(), "当前衣橱或图片预算无法支持此次设计，请调整输入");
            }
        }
        var snapshot = new LinkedHashMap<String, Object>();
        snapshot.put("schemaVersion", 2);
        snapshot.put("designType", type);
        snapshot.put("normalizedRequest", input);
        if (hairstyle != null) snapshot.put("hairstyleReference", hairstyle);
        snapshot.put("personalContext", personal);
        snapshot.put("effectiveConstraints", effective);
        snapshot.put("restrictions", restrictions);
        snapshot.put("previewConflicts", conflicts);
        snapshot.put("candidateItems", candidates);
        snapshot.put("personFileId", input.get("personFileId"));
        snapshot.put("inputSummary", summary);
        snapshot.put("budgets", inputBudgets);
        snapshot.put("seed", Long.toString(seed));
        snapshot.put("candidateTruncated", select && candidates.size() < wardrobe.size());
        snapshot.put("recentOutfits", select ? history(user) : List.of());
        return snapshot;
    }

    private List<Map<String, Object>> history(Long user) {
        var result = new ArrayList<Map<String, Object>>();
        var seen = new HashSet<String>();
        for (var recent : tasks.recent(user, Math.max(1, properties.getHistoryLimit()) * 3)) {
            String source =
                    String.valueOf(
                            !"IMAGE".equals(recent.get("resumeStage"))
                                            || recent.get("retrySourceId") == null
                                    ? recent.get("taskId")
                                    : recent.get("retrySourceId"));
            if (!seen.add(source)) continue;
            var output = read(String.valueOf(recent.get("provenance")));
            var plan = map(output.get("plan"));
            if (plan.isEmpty()) continue;
            var items = list(plan.get("items"));
            result.add(
                    Map.of(
                            "taskId",
                            recent.get("taskId").toString(),
                            "selectedDressIds",
                            items.stream().map(i -> i.get("dressId")).toList(),
                            "items",
                            items,
                            "style",
                            recent.get("style"),
                            "occasion",
                            recent.get("occasion")));
            if (result.size() >= properties.getHistoryLimit()) break;
        }
        return result;
    }

    private List<Map<String, Object>> wardrobe(Long user, List<String> only) {
        List<DressRow> rows = new ArrayList<>();
        if (only == null) {
            if (dresses.count(user, null) > properties.getWardrobeScanLimit())
                throw error(503, "INPUT_SCAN_CAPACITY_EXCEEDED", "衣橱超过本次扫描容量");
            rows = dresses.list(user, null, properties.getWardrobeScanLimit(), 0);
        } else
            for (String id : only) {
                var d = dresses.dress(user, id(id));
                if (d == null) throw error(404, "RESOURCE_NOT_FOUND", "单品不存在");
                rows.add(d);
            }
        if (rows.isEmpty()) return List.of();
        var images = dresses.images(user, rows.stream().map(DressRow::getId).toList());
        var categories = dresses.categories();
        var recognitions = dresses.recognitions(user, rows.stream().map(DressRow::getId).toList());
        var result = new ArrayList<Map<String, Object>>();
        for (var d : rows) {
            var category =
                    categories.stream()
                            .filter(c -> c.getId().equals(d.getCategoryId().toString()))
                            .findFirst()
                            .orElse(null);
            if (category == null) continue;
            List<Map<String, Object>> imgs = new ArrayList<>();
            for (var i : images)
                if (i.getDressId().equals(d.getId())) {
                    var f = files.find(user, i.getAssetId());
                    if (!available(f)) continue;
                    var features = new LinkedHashMap<String, Object>();
                    if (i.getRecognitionId() != null
                            && Objects.equals(i.getRecognitionRevision(), d.getImageRevision())
                            && recognitions.stream()
                                    .anyMatch(
                                            r ->
                                                    Objects.equals(r.getId(), i.getRecognitionId())
                                                            && "SUCCEEDED".equals(r.getStatus()))) {
                        features.put("viewType", i.getViewType());
                        features.put("description", i.getDescription());
                        features.put(
                                "colors",
                                i.getColors() == null
                                        ? null
                                        : json.readValue(i.getColors(), List.class));
                        features.put(
                                "styleTags",
                                i.getStyleTags() == null
                                        ? null
                                        : json.readValue(i.getStyleTags(), List.class));
                        features.put("fit", i.getFit());
                        features.put("pattern", i.getPattern());
                        features.put("materialDescription", i.getMaterialDescription());
                        features.put(
                                "details",
                                i.getDetails() == null
                                        ? null
                                        : json.readValue(i.getDetails(), Map.class));
                    }
                    if (i.getManualFeatures() != null) features.putAll(read(i.getManualFeatures()));
                    imgs.add(
                            Map.of(
                                    "imageId",
                                    i.getId().toString(),
                                    "fileId",
                                    i.getAssetId().toString(),
                                    "sortOrder",
                                    i.getSortOrder(),
                                    "features",
                                    features,
                                    "sizeBytes",
                                    f.getSizeBytes(),
                                    "manualFit",
                                    Objects.toString(read(i.getManualFeatures()).get("fit"), "")));
                }
            if (imgs.isEmpty()) continue;
            var row = new LinkedHashMap<String, Object>();
            row.put("dressId", d.getId().toString());
            row.put("name", d.getName());
            row.put("categoryCode", category.getCode());
            row.put("categoryName", category.getName());
            row.put("color", d.getColor());
            row.put("seasons", d.getSeasonMask());
            row.put("notes", d.getNotes());
            row.put("images", imgs);
            result.add(row);
        }
        return result;
    }

    private void validateRetryBudget(
            Map<String, Object> snapshot, Map<String, Object> result, String mode, Long user) {
        var selected = new LinkedHashSet<Long>();
        boolean evaluation = "EVALUATION".equals(snapshot.get("jobKind"));
        if (!evaluation) requireImageCapability(map(snapshot.get("normalizedRequest")));
        if (snapshot.get("personFileId") != null) selected.add(id(snapshot.get("personFileId")));
        var hairstyle = map(snapshot.get("hairstyleReference"));
        int referenceCount = list(hairstyle.get("images")).size();
        long referenceBytes = hairstyles.referenceBytes(hairstyle);
        int count = (snapshot.get("personFileId") == null ? 0 : 1) + referenceCount;
        if (mode.equals("IMAGE_ONLY")) {
            var output = read(String.valueOf(result.get("provenance")));
            for (var item : list(map(output.get("plan")).get("items")))
                for (var dress : list(snapshot.get("candidateItems")))
                    if (dress.get("dressId").equals(item.get("dressId")))
                        for (var image : list(dress.get("images")))
                            if (((List<?>) item.get("referenceImageIds"))
                                    .contains(image.get("imageId"))) {
                                selected.add(id(image.get("fileId")));
                                count++;
                            }
            if (count > effectiveImageMaxImages())
                throw error(409, "RETRY_INPUT_INCOMPATIBLE", "当前生图图片预算无法容纳原方案");
        } else {
            for (var dress : list(snapshot.get("candidateItems"))) {
                var images = list(dress.get("images"));
                if (images.isEmpty()) throw error(409, "RETRY_INPUT_UNAVAILABLE", "原图片快照不可用");
                var image =
                        images.stream()
                                .filter(i -> "FRONT".equals(map(i.get("features")).get("viewType")))
                                .findFirst()
                                .orElse(images.getFirst());
                selected.add(id(image.get("fileId")));
                count++;
            }
            int requiredCount =
                    ((List<?>) map(snapshot.get("normalizedRequest")).get("requiredDressIds"))
                            .size();
            if (count > properties.getPlanningMaxImages()
                    || (!evaluation
                            && requiredCount + 1 + referenceCount > effectiveImageMaxImages()))
                throw error(409, "RETRY_INPUT_INCOMPATIBLE", "当前规划图片预算无法容纳原输入");
        }
        long bytes = referenceBytes;
        for (Long file : selected)
            bytes = Math.addExact(bytes, retained(user, file, false).getSizeBytes());
        if (bytes > properties.getMaxInputBytes()
                || (mode.equals("IMAGE_ONLY")
                                ? String.valueOf(result.get("prompt")).length()
                                : json.writeValueAsString(snapshot).length())
                        > properties.getMaxTextChars())
            throw error(409, "RETRY_INPUT_INCOMPATIBLE", "当前输入预算无法容纳原输入");
    }

    private void bindSnapshot(GenerationTaskRow row, Map<String, Object> snapshot) {
        Long user = row.getUserId();
        Long person =
                snapshot.get("personFileId") == null ? null : id(snapshot.get("personFileId"));
        boolean fixed = Boolean.TRUE.equals(snapshot.get("fixedOutfit"));
        var refs = new TreeSet<Long>();
        if (person != null) refs.add(person);
        for (var d : list(snapshot.get("candidateItems")))
            for (var i : list(d.get("images"))) refs.add(id(i.get("fileId")));
        for (Long ref : refs) {
            if (fixed && !ref.equals(person)) {
                retained(user, ref, true);
            } else {
                usable(user, ref, true);
            }
            dresses.bindFile(user, ref);
        }
        if (person != null) tasks.asset(user, row.getId(), person, "PERSON", null, null, 0);
        int pos = 0;
        for (var d : list(snapshot.get("candidateItems")))
            for (var i : list(d.get("images")))
                tasks.asset(
                        user,
                        row.getId(),
                        id(i.get("fileId")),
                        "CANDIDATE",
                        id(d.get("dressId")),
                        fixed ? null : id(i.get("imageId")),
                        pos++);
    }

    public void savePlan(
            GenerationTaskRow row,
            Map<String, Object> snapshot,
            Map<String, Object> output,
            String prompt,
            boolean bindDresses) {
        var plan = map(output.get("plan"));
        var values = new LinkedHashMap<>(plan);
        values.put("user", row.getUserId());
        values.put("task", row.getId());
        values.put("prompt", prompt);
        values.put("provenance", json.writeValueAsString(output));
        tasks.resultInsert(values);
        Long result = ((Number) values.get("id")).longValue();
        int pos = 0, assetPos = 0;
        for (var item : list(plan.get("items"))) {
            var dress =
                    list(snapshot.get("candidateItems")).stream()
                            .filter(d -> d.get("dressId").equals(item.get("dressId")))
                            .findFirst()
                            .orElseThrow();
            var v = new LinkedHashMap<>(item);
            v.put("user", row.getUserId());
            v.put("result", result);
            v.put("name", dress.get("name"));
            v.put("categoryName", dress.get("categoryName"));
            v.put("position", pos++);
            tasks.item(v);
            if (bindDresses)
                for (Object iid : (List<?>) item.get("referenceImageIds")) {
                    var image =
                            list(dress.get("images")).stream()
                                    .filter(i -> i.get("imageId").equals(iid))
                                    .findFirst()
                                    .orElseThrow();
                    tasks.asset(
                            row.getUserId(),
                            row.getId(),
                            id(image.get("fileId")),
                            "DRESS",
                            id(dress.get("dressId")),
                            Boolean.TRUE.equals(snapshot.get("fixedOutfit")) ? null : id(iid),
                            assetPos++);
                }
        }
        if (plan.get("hairstyle") instanceof Map<?, ?>) {
            var hair = new LinkedHashMap<>(map(plan.get("hairstyle")));
            hair.put("user", row.getUserId());
            hair.put("result", result);
            tasks.hairstyle(hair);
        }
    }

    private void checkToken(
            Long user, Map<String, Object> input, Map<String, Object> summary, Object raw) {
        try {
            if (!(raw instanceof String token) || token.length() > 4096) throw invalid();
            String[] parts = token.split("\\.");
            if (parts.length != 2
                    || !MessageDigest.isEqual(
                            sign(parts[0]).getBytes(StandardCharsets.UTF_8),
                            parts[1].getBytes(StandardCharsets.UTF_8))) throw invalid();
            var data =
                    read(
                            new String(
                                    Base64.getUrlDecoder().decode(parts[0]),
                                    StandardCharsets.UTF_8));
            if (!user.toString().equals(data.get("user"))
                    || !digest(input).equals(data.get("input"))) throw invalid();
            if (((Number) data.get("expires")).longValue() < Instant.now().getEpochSecond())
                throw error(409, "PREVIEW_EXPIRED", "预览已过期，请重新预览");
            if (!LocalDate.now(ZoneId.of("Asia/Shanghai")).toString().equals(data.get("date"))
                    || !digest(summary).equals(data.get("context")))
                throw error(409, "PREVIEW_STALE", "输入资料已变化，请重新预览");
        } catch (ApiException e) {
            if (e.getCode().startsWith("PREVIEW_")) throw e;
            throw error(409, "PREVIEW_INVALID", "预览凭证无效，请重新预览");
        } catch (Exception e) {
            throw error(409, "PREVIEW_INVALID", "预览凭证无效，请重新预览");
        }
    }

    private String sign(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(
                    new SecretKeySpec(
                            properties.getPreviewSecret().getBytes(StandardCharsets.UTF_8),
                            "HmacSHA256"));
            return Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Preview signature unavailable", e);
        }
    }

    public String digest(Object value) {
        return sha(json.writeValueAsString(canonical(value)));
    }

    private Object canonical(Object value) {
        if (value instanceof Map<?, ?> m) {
            var sorted = new TreeMap<String, Object>();
            m.forEach((k, v) -> sorted.put(k.toString(), canonical(v)));
            return sorted;
        }
        if (value instanceof List<?> l) return l.stream().map(this::canonical).toList();
        return value;
    }

    private static String sha(String s) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public Map<String, Object> normalize(Map<String, Object> b) {
        fields(
                b,
                Set.of(
                        "designType",
                        "personFileId",
                        "profileVersion",
                        "requirements",
                        "occasion",
                        "style",
                        "weatherNote",
                        "requiredDressIds",
                        "useMeasurements",
                        "measurementId",
                        "constraintOverrides",
                        "hairstyleId",
                        "hairstyleVersion",
                        "useReferenceHairColor"));
        var r = new LinkedHashMap<String, Object>();
        String type = String.valueOf(b.get("designType"));
        if (!Set.of("HAIRSTYLE", "OUTFIT", "OVERALL").contains(type)) throw invalid();
        r.put("designType", type);
        r.put("personFileId", id(b.get("personFileId")).toString());
        Object v = b.get("profileVersion");
        if (!(v instanceof String vs) || !vs.matches("0|[1-9][0-9]{0,18}")) throw invalid();
        try {
            Long.parseLong(vs);
        } catch (NumberFormatException e) {
            throw invalid();
        }
        r.put("profileVersion", vs);
        for (var e :
                Map.of("requirements", 2000, "occasion", 100, "style", 100, "weatherNote", 200)
                        .entrySet()) r.put(e.getKey(), text(b.get(e.getKey()), e.getValue()));
        r.put("requiredDressIds", ids(b, "requiredDressIds", true));
        r.put("constraintOverrides", ids(b, "constraintOverrides", false));
        Object use = b.getOrDefault("useMeasurements", !type.equals("HAIRSTYLE"));
        if (!(use instanceof Boolean)) throw invalid();
        r.put("useMeasurements", use);
        r.put(
                "measurementId",
                b.get("measurementId") == null ? null : id(b.get("measurementId")).toString());
        if (Boolean.FALSE.equals(use) && r.get("measurementId") != null) throw invalid();
        if (type.equals("HAIRSTYLE")
                && (Boolean.TRUE.equals(use)
                        || !((List<?>) r.get("requiredDressIds")).isEmpty()
                        || r.get("weatherNote") != null)) throw invalid();
        Object hairstyleId = b.get("hairstyleId");
        Object hairstyleVersion = b.get("hairstyleVersion");
        Object referenceColor = b.getOrDefault("useReferenceHairColor", false);
        if (!(referenceColor instanceof Boolean)) throw invalid();
        if (hairstyleId == null) {
            if (hairstyleVersion != null || Boolean.TRUE.equals(referenceColor)) throw invalid();
        } else {
            if (!"HAIRSTYLE".equals(type)
                    || !(hairstyleId instanceof String hid)
                    || !hid.matches("[a-z0-9][a-z0-9-]{0,63}")
                    || !(hairstyleVersion instanceof String hv)
                    || !hv.matches("v[1-9][0-9]{0,8}")) throw invalid();
            r.put("hairstyleId", hairstyleId);
            r.put("hairstyleVersion", hairstyleVersion);
            r.put("useReferenceHairColor", referenceColor);
        }
        return r;
    }

    private static List<String> ids(Map<String, Object> b, String key, boolean numeric) {
        Object raw = b.getOrDefault(key, List.of());
        if (!(raw instanceof List<?> l) || l.size() > 64) throw invalid();
        var values = new TreeSet<String>();
        for (Object o : l) {
            if (!(o instanceof String s) || s.length() > 200 || s.isBlank()) throw invalid();
            if (numeric) id(s);
            if (!values.add(s)) throw invalid();
        }
        return new ArrayList<>(values);
    }

    private static String text(Object value, int max) {
        if (value == null) return null;
        if (!(value instanceof String s)) throw invalid();
        s = s.replace("\r\n", "\n").strip();
        if (s.codePointCount(0, s.length()) > max) throw invalid();
        return s.isBlank() ? null : s;
    }

    public static Long id(Object value) {
        if (!(value instanceof String s) || !s.matches("[1-9][0-9]{0,18}")) throw invalid();
        try {
            return Long.valueOf(s);
        } catch (NumberFormatException e) {
            throw invalid();
        }
    }

    private static void validateKey(String key) {
        if (key == null
                || !key.matches(
                        "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))
            throw invalid();
    }

    public FileAssetRow usable(Long user, Long id, boolean lock) {
        var f = lock ? files.lock(user, id) : files.find(user, id);
        if (f == null) throw error(404, "RESOURCE_NOT_FOUND", "图片不存在");
        if (!available(f)) throw error(409, "FILE_NOT_USABLE", "图片尚未上传完成、已过期或正在清理");
        return f;
    }

    /** Existing task references retain READY files even after their wardrobe source is removed. */
    public FileAssetRow retained(Long user, Long id, boolean lock) {
        var f = lock ? files.lock(user, id) : files.find(user, id);
        if (f == null) throw error(404, "RESOURCE_NOT_FOUND", "图片不存在");
        if (!"READY".equals(f.getStatus()) || files.directReferences(id) == 0)
            throw error(409, "FILE_NOT_USABLE", "任务引用的图片不可用");
        return f;
    }

    private static boolean available(FileAssetRow f) {
        return f != null
                && f.getCleanupAfter() == null
                && f.getSizeBytes() != null
                && f.getSizeBytes() > 0
                && Set.of("READY", "TEMP").contains(f.getStatus())
                && (f.getExpiresAt() == null
                        || f.getExpiresAt()
                                .isAfter(f.getDbNow() == null ? Instant.now() : f.getDbNow()));
    }

    public Map<String, Object> read(String value) {
        return value == null ? Map.of() : json.readValue(value, Map.class);
    }

    public static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Map.of();
    }

    public static List<Map<String, Object>> list(Object value) {
        return value instanceof List<?> ? (List<Map<String, Object>>) value : List.of();
    }

    private static Long number(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }

    public static ApiException error(int status, String code, String message) {
        return new ApiException(status, code, message);
    }

    private static ApiException invalid() {
        return error(400, "VALIDATION_ERROR", "设计输入格式不正确");
    }

    private static void fields(Map<String, Object> b, Set<String> allowed) {
        if (b == null || !allowed.containsAll(b.keySet())) throw invalid();
    }

    public static Map<String, Object> response(GenerationTaskRow row) {
        var r = new LinkedHashMap<String, Object>();
        r.put("taskId", row.getId().toString());
        r.put("status", row.getStatus());
        r.put("statusUrl", "/api/designs/" + row.getId());
        if (row.getRetryOfTaskId() != null)
            r.put("retryOfTaskId", row.getRetryOfTaskId().toString());
        return r;
    }
}
