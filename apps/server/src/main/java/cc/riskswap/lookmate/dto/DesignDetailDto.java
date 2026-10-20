package cc.riskswap.lookmate.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DesignDetailDto extends TaskSummaryDto {
    private DesignResultDto result;
}
