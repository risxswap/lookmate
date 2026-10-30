package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.UserEntity;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {
    @Select("SELECT * FROM `user` WHERE id=#{id} FOR UPDATE")
    UserEntity lock(Long id);

    @Select("SELECT * FROM `user` WHERE wechat_app_id=#{appId} AND wechat_open_id=#{openId}")
    UserEntity wechat(@Param("appId") String appId, @Param("openId") String openId);

    @Update("UPDATE `user` SET avatar_file_id=#{fileId},updated_at=UTC_TIMESTAMP(3) WHERE id=#{id}")
    int avatar(@Param("id") Long id, @Param("fileId") Long fileId);

    @Update(
            "UPDATE `user` SET password_hash=#{newHash}, auth_version=auth_version+1, updated_at=#{updatedAt} "
                    + "WHERE id=#{id} AND status='ACTIVE' AND BINARY password_hash=BINARY #{oldHash}")
    int changePassword(
            @Param("id") String id,
            @Param("oldHash") String oldHash,
            @Param("newHash") String newHash,
            @Param("updatedAt") LocalDateTime updatedAt);
}
