package cc.riskswap.lookmate.common.model.dto;

import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class PhotoSlotsDto {
    private String version;
    private PhotoDto portrait;
    private PhotoDto fullBody;
    private List<PhotoDto> supplements;
    private long supplementTotal;
    private long total;
    private Map<String, PhotoDto> angles;
}
