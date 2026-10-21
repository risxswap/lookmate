package cc.riskswap.lookmate.mapper;

import java.util.List;
import cc.riskswap.lookmate.entity.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface ProfileMapper {
    String PROFILE_COLUMNS="id,username,display_name,version,current_measurement_id,default_portrait_id,default_full_body_id";
    @Select("SELECT "+PROFILE_COLUMNS+" FROM `user` WHERE id=#{user}") ProfileRow profile(Long user);
    @Select("SELECT "+PROFILE_COLUMNS+" FROM `user` WHERE id=#{user} FOR UPDATE") ProfileRow lockUser(Long user);
    @Update("UPDATE `user` SET display_name=#{displayName},current_measurement_id=#{currentMeasurementId},default_portrait_id=#{defaultPortraitId},default_full_body_id=#{defaultFullBodyId},version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND version=#{version}") int update(ProfileRow row);
    @Select("SELECT * FROM body_measurement WHERE user_id=#{user} AND id=#{id}") MeasurementRow measurement(Long user,Long id);
    @Select("SELECT * FROM body_measurement WHERE user_id=#{user} ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}") List<MeasurementRow> measurements(Long user,int limit,long offset);
    @Select("SELECT COUNT(*) FROM body_measurement WHERE user_id=#{user}") long measurementCount(Long user);
    @Delete("DELETE FROM body_measurement WHERE user_id=#{user} AND id=#{id}") int deleteMeasurement(Long user,Long id);
    @Insert("INSERT INTO body_measurement(user_id,height,weight,neck,chest,underbust,waist,abdomen,hip,shoulder,back_width,arm_length,upper_arm,forearm,wrist,front_waist_length,back_waist_length,inseam,outseam,thigh,knee,calf,ankle,head,left_foot_length,right_foot_length,left_foot_width,right_foot_width,created_at,updated_at) VALUES(#{userId},#{height},#{weight},#{neck},#{chest},#{underbust},#{waist},#{abdomen},#{hip},#{shoulder},#{backWidth},#{armLength},#{upperArm},#{forearm},#{wrist},#{frontWaistLength},#{backWaistLength},#{inseam},#{outseam},#{thigh},#{knee},#{calf},#{ankle},#{head},#{leftFootLength},#{rightFootLength},#{leftFootWidth},#{rightFootWidth},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys=true,keyProperty="id") int createMeasurement(MeasurementRow row);
    @Select("SELECT * FROM user_photo WHERE user_id=#{user} AND id=#{id}") PhotoRow photo(Long user,Long id);
    @Select("<script>SELECT * FROM user_photo WHERE user_id=#{user}<if test='type != null'> AND photo_type=#{type}</if> ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}</script>") List<PhotoRow> photos(Long user,String type,int limit,long offset);
    @Select("<script>SELECT COUNT(*) FROM user_photo WHERE user_id=#{user}<if test='type != null'> AND photo_type=#{type}</if></script>") long photoCount(Long user,String type);
    @Insert("INSERT INTO user_photo(user_id,asset_id,photo_type,created_at,updated_at) VALUES(#{userId},#{assetId},#{photoType},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys=true,keyProperty="id") int createPhoto(PhotoRow row);
    @Delete("DELETE FROM user_photo WHERE user_id=#{user} AND id=#{id}") int deletePhoto(Long user,Long id);
}
