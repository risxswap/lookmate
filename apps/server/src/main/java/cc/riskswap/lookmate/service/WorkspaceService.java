package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.DesignDetailDto;
import cc.riskswap.lookmate.common.model.dto.TaskSummaryDto;
import cc.riskswap.lookmate.common.model.dto.WorkspaceDto;
import cc.riskswap.lookmate.dao.entity.TaskQueryRow;
import cc.riskswap.lookmate.dao.mapper.DesignQueryMapper;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class WorkspaceService {
    private final DesignQueryMapper queries;
    private final GenerationService generation;
    private final cc.riskswap.lookmate.dao.mapper.GenerationMapper generationQueries;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public WorkspaceDto workspace(Long userId) {
        var workspace = new WorkspaceDto();
        var active = queries.findActive(userId);
        workspace.setActiveTask(active == null ? null : summary(active, new TaskSummaryDto()));
        workspace.setRecentTasks(
                queries.findRecent(userId).stream()
                        .map(row -> summary(row, new TaskSummaryDto()))
                        .toList());
        return workspace;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public DesignDetailDto detail(Long userId, String id) {
        Long taskId = parseId(id);
        var row = queries.findTask(userId, taskId);
        if (row == null) {
            throw new ApiException(404, "DESIGN_NOT_FOUND", "设计记录不存在");
        }
        var detail = summary(row, new DesignDetailDto());
        var result = queries.findResult(userId, taskId);
        if (result != null) {
            Long resultId = Long.valueOf(result.getId());
            result.setHairstyle(queries.findHairstyle(userId, resultId));
            result.setItems(queries.findItems(userId, resultId));
        }
        detail.setResult(result);
        var task = generationQueries.get(userId, taskId);
        if (task != null) {
            var snapshot = generation.read(task.getInputSnapshot());
            var summary =
                    new java.util.LinkedHashMap<>(
                            GenerationService.map(snapshot.get("inputSummary")));
            if (!summary.isEmpty()) {
                var required = new java.util.ArrayList<java.util.Map<String, Object>>();
                for (var d : GenerationService.list(summary.get("requiredDresses"))) {
                    var safe = new java.util.LinkedHashMap<>(d);
                    safe.remove("snapshotDigest");
                    // Read early fixed-outfit snapshots without rewriting their immutable inputs.
                    if (Boolean.TRUE.equals(snapshot.get("fixedOutfit"))
                            && !safe.containsKey("dressName")) {
                        safe.put("dressName", safe.remove("name"));
                        safe.put(
                                "imageFileIds",
                                GenerationService.list(safe.remove("images")).stream()
                                        .map(image -> image.get("fileId"))
                                        .toList());
                    }
                    required.add(safe);
                }
                summary.put("requiredDresses", required);
                detail.setInputSummary(summary);
            }
            if (task.getOutcomeSnapshot() != null) {
                var failure =
                        new java.util.LinkedHashMap<>(generation.read(task.getOutcomeSnapshot()));
                failure.remove("schemaVersion");
                detail.setFailure(failure);
            }
            for (var asset : generationQueries.assets(userId, taskId))
                if ("OUTPUT".equals(asset.get("role")) && "SUCCEEDED".equals(task.getStatus()))
                    detail.setOutputFileId(asset.get("assetId").toString());
            var saved = generationQueries.result(userId, taskId);
            if (result != null && saved != null) {
                var plan =
                        GenerationService.map(
                                generation
                                        .read(String.valueOf(saved.get("provenance")))
                                        .get("plan"));
                result.setMatchLevel((String) plan.get("matchLevel"));
                var notices = new java.util.ArrayList<java.util.Map<String, Object>>();
                for (var notice : GenerationService.list(plan.get("limitations")))
                    notices.add(
                            java.util.Map.of(
                                    "code",
                                    notice.get("code"),
                                    "message",
                                    notice.get("message"),
                                    "severity",
                                    notice.get("severity"),
                                    "placement",
                                    "NEAR_IMAGE"));
                for (var interpretation : GenerationService.list(plan.get("interpretations")))
                    notices.add(
                            java.util.Map.of(
                                    "code",
                                    "INTERPRETATION",
                                    "message",
                                    interpretation.get("interpretation"),
                                    "severity",
                                    "INFO",
                                    "placement",
                                    "DETAILS"));
                if (plan.get("illustrativeShoes") instanceof java.util.Map<?, ?>) {
                    var shoes =
                            new java.util.LinkedHashMap<>(
                                    GenerationService.map(plan.get("illustrativeShoes")));
                    shoes.put("source", "AI_ILLUSTRATION");
                    result.setIllustrativeShoes(shoes);
                    notices.removeIf(n -> "ILLUSTRATIVE_SHOES".equals(n.get("code")));
                    notices.add(
                            java.util.Map.of(
                                    "code",
                                    "ILLUSTRATIVE_SHOES",
                                    "message",
                                    "鞋子为 AI 生成示意，非衣橱单品",
                                    "severity",
                                    "INFO",
                                    "placement",
                                    "NEAR_IMAGE"));
                }
                if ("EVALUATION".equals(snapshot.get("jobKind"))
                        && snapshot.get("personFileId") == null)
                    notices.add(
                            java.util.Map.of(
                                    "code",
                                    "LIMITED_VISUAL_EVIDENCE",
                                    "message",
                                    "未提供本人照片，仅评价配色、组合和穿法，不判断实际上身效果",
                                    "severity",
                                    "INFO",
                                    "placement",
                                    "DETAILS"));
                result.setNotices(notices);
                if (plan.get("novelty") instanceof java.util.Map<?, ?>)
                    result.setNovelty(
                            java.util.Map.of(
                                    "description",
                                    GenerationService.map(plan.get("novelty")).get("explanation")));
                for (var item : result.getItems())
                    for (var p : GenerationService.list(plan.get("items")))
                        if (item.getDressId().equals(p.get("dressId"))) {
                            item.setRole((String) p.get("role"));
                            var ids = new java.util.ArrayList<String>();
                            for (var d : GenerationService.list(snapshot.get("candidateItems")))
                                if (item.getDressId().equals(d.get("dressId")))
                                    for (var image : GenerationService.list(d.get("images")))
                                        if (((java.util.List<?>) p.get("referenceImageIds"))
                                                .contains(image.get("imageId")))
                                            ids.add((String) image.get("fileId"));
                            item.setImageFileIds(ids);
                        }
            }
            var actions = new java.util.ArrayList<>(detail.getActions());
            if (!summary.isEmpty()
                    && !Boolean.TRUE.equals(snapshot.get("fixedOutfit"))
                    && java.util.Set.of("SUCCEEDED", "FAILED", "UNKNOWN")
                            .contains(task.getStatus())) actions.add("NEW_FROM_INPUT");
            if ("UNKNOWN".equals(task.getStatus())) actions.add("REFRESH");
            if ("FAILED".equals(task.getStatus())
                    && !GenerationService.isInputFailure(task.getErrorCode())
                    && Integer.valueOf(2).equals(snapshot.get("schemaVersion"))
                    && generation.hairstyleRetryAvailable(snapshot)) {
                actions.add("RETRY_FULL");
                if (saved != null && !"EVALUATION".equals(snapshot.get("jobKind")))
                    actions.add("RETRY_IMAGE");
            }
            detail.setActions(actions);
        }
        return detail;
    }

    private Long parseId(String id) {
        if (id == null || !id.matches("[1-9][0-9]{0,18}")) {
            throw new ApiException(400, "INVALID_REQUEST", "设计编号不合法");
        }
        try {
            return Long.valueOf(id);
        } catch (NumberFormatException exception) {
            throw new ApiException(400, "INVALID_REQUEST", "设计编号不合法");
        }
    }

    public static <T extends TaskSummaryDto> T summary(TaskQueryRow row, T dto) {
        dto.setId(row.getId().toString());
        dto.setDesignType(row.getDesignType());
        dto.setOutfitId(row.getOutfitId());
        dto.setJobKind(row.getJobKind());
        dto.setStatus(row.getStatus());
        dto.setCreatedAt(row.getCreatedAt().toInstant(ZoneOffset.UTC).toString());
        dto.setUpdatedAt(row.getUpdatedAt().toInstant(ZoneOffset.UTC).toString());
        dto.setTitle(row.getTitle());
        dto.setSummary(row.getSummary());
        dto.setErrorCode(row.getErrorCode());
        dto.setErrorMessage(row.getErrorMessage());
        dto.setResultId(row.getResultId() == null ? null : row.getResultId().toString());
        dto.setFavoriteId(row.getFavoriteId() == null ? null : row.getFavoriteId().toString());
        dto.setActions(
                "SUCCEEDED".equals(row.getStatus())
                                && row.getResultId() != null
                                && !"EVALUATION".equals(row.getJobKind())
                        ? List.of("VIEW", row.getFavoriteId() == null ? "FAVORITE" : "UNFAVORITE")
                        : List.of("VIEW"));
        var allowed = new java.util.ArrayList<>(dto.getActions());
        if (java.util.Set.of("SUCCEEDED", "FAILED").contains(row.getStatus()))
            allowed.add("DELETE");
        if ("UNKNOWN".equals(row.getStatus())) allowed.add("HIDE");
        dto.setActions(allowed);
        return dto;
    }
}
