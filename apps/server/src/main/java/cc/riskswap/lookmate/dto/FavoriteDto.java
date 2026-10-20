package cc.riskswap.lookmate.dto;

import lombok.*;
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class FavoriteDto {
    private String id;
    private String resultId;
    private String createdAt;
    private java.util.List<String> collectionIds;
    private TaskSummaryDto task;
}
