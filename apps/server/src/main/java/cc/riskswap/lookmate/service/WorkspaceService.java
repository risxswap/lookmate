package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.dto.DesignDetailDto;
import cc.riskswap.lookmate.dto.TaskSummaryDto;
import cc.riskswap.lookmate.dto.WorkspaceDto;
import cc.riskswap.lookmate.entity.TaskQueryRow;
import cc.riskswap.lookmate.mapper.DesignQueryMapper;
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
                "SUCCEEDED".equals(row.getStatus()) && row.getResultId() != null
                        ? List.of("VIEW", row.getFavoriteId() == null ? "FAVORITE" : "UNFAVORITE")
                        : List.of("VIEW"));
        return dto;
    }
}
