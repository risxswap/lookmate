package cc.riskswap.lookmate.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProfileDto {
    private String id;
    private String username;
    private String displayName;
    private String version;
    private String currentMeasurementId;
    private String defaultPortraitId;
    private String defaultFullBodyId;
    private MeasurementDto currentMeasurement;
}
