package cc.riskswap.lookmate.dao.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("`user`")
public class UserEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    private String username;
    private String passwordHash;
    private String status;
    private String displayName;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
