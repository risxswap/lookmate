package cc.riskswap.lookmate.dao.entity;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PreferenceRow {
    private Long userId;
    private String interests;
    private String styles;
    private String preferredColors;
    private String avoidedColors;
    private String fits;
    private String hairLengths;
    private String restrictions;
    private String dyeAcceptance;
    private String permAcceptance;
    private String groomingEffort;
    private String outfitNote;
    private String hairNote;
    private String restrictionNote;
}
