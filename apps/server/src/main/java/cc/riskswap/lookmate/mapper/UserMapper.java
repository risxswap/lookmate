package cc.riskswap.lookmate.mapper;

import cc.riskswap.lookmate.entity.UserEntity;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
import java.time.LocalDateTime;

@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {
    @Update("UPDATE `user` SET password_hash=#{newHash}, updated_at=#{updatedAt} "
            + "WHERE id=#{id} AND status='ACTIVE' AND BINARY password_hash=BINARY #{oldHash}")
    int changePassword(@Param("id") String id, @Param("oldHash") String oldHash,
                       @Param("newHash") String newHash, @Param("updatedAt") LocalDateTime updatedAt);

}
