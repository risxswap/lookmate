package cc.riskswap.lookmate.service;

import static cc.riskswap.lookmate.service.GenerationService.*;

import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.common.model.param.RecordParameters;
import cc.riskswap.lookmate.dao.mapper.GenerationMapper;
import cc.riskswap.lookmate.dao.mapper.OutfitAiMapper;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Outfit-specific input and projection; execution uses the existing design queue. */
@Service
@RequiredArgsConstructor
public class OutfitAiService {
    private final OutfitService outfits;
    private final OutfitAiMapper jobs;
    private final GenerationMapper tasks;
    private final GenerationService generation;
    private final WorkspaceService workspace;

    public Map<String, Object> submit(
            Long user, String outfitId, String key, Map<String, Object> body) {
        fields(body, Set.of("kind", "revision", "personFileId"));
        String kind = String.valueOf(body.get("kind"));
        if (!Set.of("EVALUATION", "IMAGE").contains(kind)) throw invalid();
        String revision = revision(body.get("revision"));
        String person =
                body.get("personFileId") == null ? null : id(body.get("personFileId")).toString();
        if ("IMAGE".equals(kind) && person == null)
            throw error(400, "PERSON_PHOTO_REQUIRED", "生成效果图需要本人照片");
        Long outfit = id(outfitId);
        var normalized = new LinkedHashMap<String, Object>();
        normalized.put("operation", "OUTFIT_AI");
        normalized.put("outfitId", outfitId);
        normalized.put("revision", revision);
        normalized.put("kind", kind);
        normalized.put("personFileId", person);
        var submitted =
                generation.submitOutfit(
                        user,
                        key,
                        generation.digest(normalized),
                        kind,
                        () -> snapshot(user, outfitId, revision, kind, person),
                        row ->
                                jobs.insert(
                                        user, row.getId(), outfit, Long.valueOf(revision), kind));
        return detail(user, (String) submitted.get("taskId"));
    }

    private Map<String, Object> snapshot(
            Long user, String outfitId, String revision, String kind, String person) {
        var outfit = outfits.snapshotForGeneration(user, outfitId, revision);
        var candidates = new ArrayList<Map<String, Object>>();
        var categories = new HashSet<String>();
        boolean evaluation = "EVALUATION".equals(kind);
        long bytes = person == null ? 0 : generation.usable(user, id(person), false).getSizeBytes();
        int count = person == null ? 0 : 1;
        for (var item : GenerationService.list(outfit.get("items"))) {
            if (!evaluation && Boolean.TRUE.equals(item.get("missing")))
                throw error(409, "DRESS_NOT_USABLE", "组合中有已删除的单品，请先编辑替换");
            var images = new ArrayList<Map<String, Object>>();
            var features = GenerationService.list(item.get("features"));
            int position = 0;
            for (Object raw : (List<?>) item.get("imageFileIds")) {
                String fileId = id(raw).toString();
                var file = generation.retained(user, id(fileId), false);
                // A snapshot image ID is its retained asset ID, not a mutable dress_image row.
                var image = new LinkedHashMap<String, Object>();
                image.put("imageId", fileId);
                image.put("fileId", fileId);
                image.put("sortOrder", position);
                image.put(
                        "features", position < features.size() ? features.get(position) : Map.of());
                image.put("sizeBytes", file.getSizeBytes());
                images.add(image);
                position++;
            }
            if (images.isEmpty()) throw error(409, "FILE_NOT_USABLE", "单品快照没有可用图片");
            var representative =
                    images.stream()
                            .filter(i -> "FRONT".equals(map(i.get("features")).get("viewType")))
                            .findFirst()
                            .orElse(images.getFirst());
            bytes = Math.addExact(bytes, ((Number) representative.get("sizeBytes")).longValue());
            count++;
            var candidate = new LinkedHashMap<String, Object>();
            candidate.put("dressId", item.get("dressId"));
            candidate.put("name", item.get("dressName"));
            candidate.put("categoryCode", item.get("categoryCode"));
            candidate.put("categoryName", item.get("categoryName"));
            candidate.put("color", item.get("color"));
            candidate.put("images", images);
            candidates.add(candidate);
            categories.add((String) item.get("categoryCode"));
        }
        if (!evaluation
                && !categories.contains("DRESS")
                && !categories.containsAll(Set.of("TOP", "BOTTOM")))
            throw error(409, "OUTFIT_NOT_FEASIBLE", "请先补齐上装和下装，或选择可独立穿着的连衣裙");
        var budgets = generation.budgets();
        if (count > ((Number) budgets.get("planningMaxImages")).intValue()
                || (!evaluation && count > ((Number) budgets.get("imageMaxImages")).intValue())
                || bytes > ((Number) budgets.get("maxInputBytes")).longValue())
            throw error(422, "INPUT_BUDGET_EXCEEDED", "固定组合超过图片预算，请减少单品数量");
        var request = new LinkedHashMap<String, Object>();
        request.put("designType", "OUTFIT");
        request.put("outfitInspirationId", null);
        request.put("outfitInspirationVersion", null);
        request.put("requirements", outfit.get("note"));
        request.put("requiredDressIds", candidates.stream().map(c -> c.get("dressId")).toList());
        var snapshot = new LinkedHashMap<String, Object>();
        snapshot.put("schemaVersion", 3);
        snapshot.put("fixedOutfit", true);
        snapshot.put("outfitInspirationReference", null);
        snapshot.put("jobKind", kind);
        snapshot.put("outfitId", outfitId);
        snapshot.put("outfitRevision", revision);
        snapshot.put("outfitSnapshot", outfit);
        snapshot.put("designType", "OUTFIT");
        snapshot.put("personFileId", person);
        snapshot.put("normalizedRequest", request);
        snapshot.put("personalContext", Map.of("photoProvided", person != null));
        snapshot.put("effectiveConstraints", List.of());
        snapshot.put("candidateItems", candidates);
        snapshot.put("candidateTruncated", false);
        snapshot.put("recentOutfits", List.of());
        snapshot.put("budgets", budgets);
        var summary = new LinkedHashMap<String, Object>();
        summary.put("schemaVersion", 3);
        summary.put("outfitInspirationReference", null);
        summary.put("designType", "OUTFIT");
        summary.put("request", request);
        summary.put("personPhoto", person == null ? null : Map.of("fileId", person));
        summary.put("constraintOverrides", List.of());
        summary.put(
                "requiredDresses",
                candidates.stream()
                        .map(
                                candidate ->
                                        Map.of(
                                                "dressId", candidate.get("dressId"),
                                                "dressName", candidate.get("name"),
                                                "categoryName", candidate.get("categoryName"),
                                                "categoryCode", candidate.get("categoryCode"),
                                                "imageFileIds",
                                                        GenerationService.list(
                                                                        candidate.get("images"))
                                                                .stream()
                                                                .map(image -> image.get("fileId"))
                                                                .toList()))
                        .toList());
        snapshot.put("inputSummary", summary);
        return snapshot;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> detail(Long user, String taskId) {
        var job = jobs.get(user, id(taskId));
        if (job == null) throw error(404, "RESOURCE_NOT_FOUND", "搭配任务不存在");
        var design = workspace.detail(user, taskId);
        String kind = (String) job.get("kind");
        var current = jobs.revision(user, ((Number) job.get("outfitId")).longValue());
        var actions = new ArrayList<String>();
        actions.add("VIEW");
        if (design.getActions().contains("RETRY_FULL")) actions.add("RETRY_FULL");
        if ("IMAGE".equals(kind) && design.getActions().contains("RETRY_IMAGE"))
            actions.add("RETRY_IMAGE");
        var response = new LinkedHashMap<String, Object>();
        response.put("taskId", taskId);
        response.put("outfitId", job.get("outfitId").toString());
        response.put("revision", job.get("revision").toString());
        response.put("kind", kind);
        response.put("status", design.getStatus());
        response.put(
                "stale",
                current == null
                        || current.longValue() != ((Number) job.get("revision")).longValue());
        response.put("createdAt", design.getCreatedAt());
        response.put("updatedAt", design.getUpdatedAt());
        response.put("errorCode", design.getErrorCode());
        response.put("errorMessage", design.getErrorMessage());
        response.put("actions", actions);
        response.put("outputFileId", design.getOutputFileId());
        response.put("result", design.getResult());
        return response;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<Map<String, Object>> list(
            Long user, String outfitId, String pageValue, String sizeValue) {
        outfits.detail(user, outfitId);
        int page = RecordParameters.page(pageValue, 1, Integer.MAX_VALUE);
        int size = RecordParameters.page(sizeValue, 20, 100);
        return new PageDto<>(
                jobs.list(user, id(outfitId), size, ((long) page - 1) * size).stream()
                        .map(task -> detail(user, task.toString()))
                        .toList(),
                page,
                size,
                jobs.count(user, id(outfitId)));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> current(Long user, String outfitId) {
        var outfit = outfits.detail(user, outfitId);
        Long outfitKey = id(outfitId);
        Long revision = Long.valueOf(outfit.getRevision());
        var response = new LinkedHashMap<String, Object>();
        response.put(
                "evaluation",
                currentDetail(user, jobs.current(user, outfitKey, revision, true, false)));
        response.put(
                "image", currentDetail(user, jobs.current(user, outfitKey, revision, false, true)));
        response.put(
                "latest",
                currentDetail(user, jobs.current(user, outfitKey, revision, false, false)));
        return response;
    }

    private Map<String, Object> currentDetail(Long user, Long taskId) {
        return taskId == null ? null : detail(user, taskId.toString());
    }

    public Map<String, Object> byKey(Long user, String key) {
        var found = generation.byKey(user, key);
        return detail(user, (String) found.get("taskId"));
    }

    public Map<String, Object> retry(
            Long user, String taskId, String key, Map<String, Object> body) {
        var source = jobs.get(user, id(taskId));
        if (source == null) throw error(404, "RESOURCE_NOT_FOUND", "搭配任务不存在");
        var submitted =
                generation.retryOutfit(
                        user,
                        taskId,
                        key,
                        body,
                        row ->
                                jobs.insert(
                                        user,
                                        row.getId(),
                                        ((Number) source.get("outfitId")).longValue(),
                                        ((Number) source.get("revision")).longValue(),
                                        (String) source.get("kind")));
        return detail(user, (String) submitted.get("taskId"));
    }

    private static String revision(Object raw) {
        if (!(raw instanceof String s) || !s.matches("0|[1-9][0-9]{0,18}")) throw invalid();
        try {
            Long.parseLong(s);
        } catch (NumberFormatException e) {
            throw invalid();
        }
        return s;
    }

    private static void fields(Map<String, Object> body, Set<String> allowed) {
        if (body == null || !allowed.containsAll(body.keySet())) throw invalid();
    }

    private static cc.riskswap.lookmate.common.exception.ApiException invalid() {
        return error(400, "VALIDATION_ERROR", "搭配 AI 请求不合法");
    }
}
