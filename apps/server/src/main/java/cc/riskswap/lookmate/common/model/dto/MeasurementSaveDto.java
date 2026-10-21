package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MeasurementSaveDto {
    private MeasurementDto measurement;
    private ProfileDto profile;
}
