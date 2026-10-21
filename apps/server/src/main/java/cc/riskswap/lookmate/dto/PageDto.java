package cc.riskswap.lookmate.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PageDto<T> {
    private java.util.List<T> items;
    private Integer page;
    private Integer pageSize;
    private Long total;
}
