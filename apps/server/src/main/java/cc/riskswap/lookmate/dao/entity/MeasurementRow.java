package cc.riskswap.lookmate.dao.entity;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MeasurementRow {
    private Long id;
    private Long userId;
    private java.math.BigDecimal height;
    private java.math.BigDecimal weight;
    private java.math.BigDecimal neck;
    private java.math.BigDecimal chest;
    private java.math.BigDecimal underbust;
    private java.math.BigDecimal waist;
    private java.math.BigDecimal abdomen;
    private java.math.BigDecimal hip;
    private java.math.BigDecimal shoulder;
    private java.math.BigDecimal backWidth;
    private java.math.BigDecimal armLength;
    private java.math.BigDecimal upperArm;
    private java.math.BigDecimal forearm;
    private java.math.BigDecimal wrist;
    private java.math.BigDecimal frontWaistLength;
    private java.math.BigDecimal backWaistLength;
    private java.math.BigDecimal inseam;
    private java.math.BigDecimal outseam;
    private java.math.BigDecimal thigh;
    private java.math.BigDecimal knee;
    private java.math.BigDecimal calf;
    private java.math.BigDecimal ankle;
    private java.math.BigDecimal head;
    private java.math.BigDecimal leftFootLength;
    private java.math.BigDecimal rightFootLength;
    private java.math.BigDecimal leftFootWidth;
    private java.math.BigDecimal rightFootWidth;
    private java.time.LocalDateTime createdAt;
    private java.time.LocalDateTime updatedAt;
}
