package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.UserEntity;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {
    @Update(
            "UPDATE `user` SET password_hash=#{newHash}, updated_at=#{updatedAt} "
                    + "WHERE id=#{id} AND status='ACTIVE' AND BINARY password_hash=BINARY #{oldHash}")
    int changePassword(
            @Param("id") String id,
            @Param("oldHash") String oldHash,
            @Param("newHash") String newHash,
            @Param("updatedAt") LocalDateTime updatedAt);
}
