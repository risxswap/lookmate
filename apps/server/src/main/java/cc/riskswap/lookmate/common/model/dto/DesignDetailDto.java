package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DesignDetailDto extends TaskSummaryDto {
    private DesignResultDto result;
}
