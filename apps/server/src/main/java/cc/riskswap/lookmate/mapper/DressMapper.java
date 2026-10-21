package cc.riskswap.lookmate.mapper;

import cc.riskswap.lookmate.dto.DressCategoryDto;
import cc.riskswap.lookmate.entity.*;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface DressMapper {
    @Select("SELECT COUNT(*) FROM dress_recognition WHERE status IN ('PENDING','RUNNING')")
    long activeRecognitionCount();

    @Select(
            "SELECT COUNT(*) FROM dress_recognition WHERE user_id=#{user} AND status IN ('PENDING','RUNNING')")
    long activeRecognitionCountForUser(Long user);

    @Select("SELECT id,code,name,sort_order FROM dress_category ORDER BY sort_order,id")
    List<DressCategoryDto> categories();

    @Select("SELECT id FROM dress_category WHERE id=#{id}")
    Long category(Long id);

    @Select("SELECT id FROM `user` WHERE id=#{user} FOR UPDATE")
    Long lockUser(Long user);

    @Select("SELECT id FROM dress WHERE user_id=#{user} AND id=#{dress} FOR UPDATE")
    Long lockDress(Long user, Long dress);

    @Select(
            "SELECT id FROM dress_image WHERE user_id=#{user} AND dress_id=#{dress} ORDER BY id FOR UPDATE")
    List<Long> lockImages(Long user, Long dress);

    @Select(
            "SELECT id FROM dress_recognition WHERE user_id=#{user} AND dress_id=#{dress} ORDER BY id FOR UPDATE")
    List<Long> lockRecognitions(Long user, Long dress);

    @Select(
            "SELECT c.id FROM model_call c JOIN dress_recognition r ON c.owner_type='DRESS_RECOGNITION' AND c.owner_id=r.id AND c.user_id=r.user_id WHERE r.user_id=#{user} AND r.dress_id=#{dress} ORDER BY c.id FOR UPDATE")
    List<Long> lockCalls(Long user, Long dress);

    @Select("SELECT * FROM dress WHERE user_id=#{user} AND id=#{id}")
    DressRow dress(Long user, Long id);

    @Select(
            "<script>SELECT * FROM dress WHERE user_id=#{user}<if test='category != null'> AND category_id=#{category}</if> ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}</script>")
    List<DressRow> list(Long user, Long category, int limit, long offset);

    @Select(
            "<script>SELECT COUNT(*) FROM dress WHERE user_id=#{user}<if test='category != null'> AND category_id=#{category}</if></script>")
    long count(Long user, Long category);

    @Select(
            "<script>SELECT i.*,r.image_revision recognition_revision FROM dress_image i LEFT JOIN dress_recognition r ON r.id=i.recognition_id AND r.user_id=i.user_id WHERE i.user_id=#{user} AND i.dress_id IN <foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach> ORDER BY i.sort_order,i.id</script>")
    List<DressImageRow> images(Long user, List<Long> ids);

    @Select(
            "<script>SELECT r.* FROM dress_recognition r JOIN dress d ON d.id=r.dress_id AND d.user_id=r.user_id AND d.image_revision=r.image_revision WHERE r.user_id=#{user} AND r.dress_id IN <foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach> AND NOT EXISTS(SELECT 1 FROM dress_recognition newer WHERE newer.dress_id=r.dress_id AND newer.image_revision=r.image_revision AND newer.attempt_no>r.attempt_no)</script>")
    List<DressRecognitionRow> recognitions(Long user, List<Long> ids);

    @Select(
            "SELECT * FROM dress_recognition WHERE user_id=#{user} AND dress_id=#{dress} AND image_revision=#{revision} ORDER BY attempt_no DESC LIMIT 1")
    DressRecognitionRow recognition(Long user, Long dress, Long revision);

    @Select(
            "SELECT id,status,expires_at,mime_type,width,height,size_bytes,(expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP(3)) expired FROM file_asset WHERE user_id=#{user} AND id=#{id} FOR UPDATE")
    DressFileRow file(Long user, Long id);

    @Update(
            "UPDATE file_asset SET status='READY',expires_at=NULL,cleanup_after=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{id}")
    int bindFile(Long user, Long id);

    @Update(
            "UPDATE file_asset SET cleanup_after=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{id} AND status='READY'")
    int scheduleCleanup(Long user, Long id);

    @Insert(
            "INSERT INTO dress(user_id,name,category_id,color,season_mask,notes,image_revision,created_at,updated_at) VALUES(#{userId},#{name},#{categoryId},#{color},#{seasonMask},#{notes},1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int create(DressRow row);

    @Update(
            "UPDATE dress SET name=#{name},category_id=#{categoryId},color=#{color},season_mask=#{seasonMask},notes=#{notes},image_revision=#{imageRevision},updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND user_id=#{userId}")
    int update(DressRow row);

    @Insert(
            "INSERT INTO dress_image(user_id,dress_id,asset_id,sort_order,created_at,updated_at) VALUES(#{userId},#{dressId},#{assetId},#{sortOrder},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int createImage(DressImageRow row);

    @Update(
            "UPDATE dress_image SET sort_order=#{sortOrder},updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND user_id=#{userId}")
    int orderImage(DressImageRow row);

    @Delete("DELETE FROM dress_image WHERE user_id=#{user} AND id=#{id}")
    int deleteImage(Long user, Long id);

    @Update(
            "UPDATE dress_image SET manual_features=#{features},version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{id} AND version=#{version}")
    int manual(Long user, Long id, Long version, String features);

    @Update(
            "UPDATE dress_recognition SET status='SUPERSEDED',attempt_token=NULL,lease_until=NULL,holds_input_assets=0,finished_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND dress_id=#{dress} AND status IN ('PENDING','RUNNING','UNKNOWN')")
    int supersede(Long user, Long dress);

    @Insert(
            "INSERT INTO dress_recognition(user_id,dress_id,image_revision,attempt_no,status,input_snapshot,config_snapshot,holds_input_assets,error_code,error_message,finished_at,created_at,updated_at) VALUES(#{user},#{dress},#{revision},#{attempt},#{status},#{snapshot},#{config},#{holds},#{code},#{message},IF(#{holds}=0,UTC_TIMESTAMP(3),NULL),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int createRecognition(
            Long user,
            Long dress,
            Long revision,
            int attempt,
            String status,
            String snapshot,
            String config,
            int holds,
            String code,
            String message);

    @Delete(
            "DELETE c FROM model_call c JOIN dress_recognition r ON c.owner_type='DRESS_RECOGNITION' AND c.owner_id=r.id AND c.user_id=r.user_id WHERE r.user_id=#{user} AND r.dress_id=#{dress}")
    int deleteCalls(Long user, Long dress);

    @Delete("DELETE FROM dress_recognition WHERE user_id=#{user} AND dress_id=#{dress}")
    int deleteRecognitions(Long user, Long dress);

    @Delete("DELETE FROM dress WHERE user_id=#{user} AND id=#{dress}")
    int deleteDress(Long user, Long dress);
}
