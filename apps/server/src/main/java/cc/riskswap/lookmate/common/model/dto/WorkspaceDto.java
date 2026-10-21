package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class WorkspaceDto {
    private TaskSummaryDto activeTask;
    private java.util.List<TaskSummaryDto> recentTasks;
}
