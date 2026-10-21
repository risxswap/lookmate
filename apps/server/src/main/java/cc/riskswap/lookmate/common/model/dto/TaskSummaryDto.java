package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class TaskSummaryDto {
    private String id;
    private String resultId;
    private String favoriteId;
    private String designType;
    private String status;
    private String createdAt;
    private String updatedAt;
    private String title;
    private String summary;
    private String errorCode;
    private String errorMessage;
    private java.util.List<String> actions;
}
