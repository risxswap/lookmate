package cc.riskswap.lookmate.common.model.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class CollectionDto {
    private String id;
    private String name;
    private String version;
    private String createdAt;
    private String updatedAt;
}
