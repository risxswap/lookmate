package cc.riskswap.lookmate.dto;
import lombok.*;
import java.util.*;
import java.time.LocalDateTime;
@Getter @Setter @NoArgsConstructor
public class DressDto {
    private String id;
    private String name;
    private String categoryId;
    private String color;
    private String notes;
    private String imageRevision;
    private String createdAt;
    private String updatedAt;
    private List<String> seasons;
    private List<DressImageDto> images;
    private DressRecognitionDto recognition;
}
