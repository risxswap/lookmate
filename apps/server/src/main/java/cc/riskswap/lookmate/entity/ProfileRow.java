package cc.riskswap.lookmate.entity;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProfileRow {
    private Long id;
    private Long version;
    private Long currentMeasurementId;
    private Long defaultPortraitId;
    private Long defaultFullBodyId;
    private String username;
    private String displayName;
    private String gender;
    private java.time.LocalDate birthDate;
}
