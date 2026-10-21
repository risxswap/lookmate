package cc.riskswap.lookmate.mapper;

import cc.riskswap.lookmate.entity.RecognitionWorkRow;
import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface RecognitionWorkMapper {
    @Select(
            "SELECT * FROM dress_recognition WHERE status='PENDING' ORDER BY created_at,id LIMIT 10")
    List<RecognitionWorkRow> pending();

    @Select(
            "SELECT * FROM dress_recognition WHERE status='RUNNING' AND lease_until<UTC_TIMESTAMP(3) ORDER BY lease_until,id LIMIT 10")
    List<RecognitionWorkRow> expired();

    @Select("SELECT id FROM user WHERE id=#{id} FOR UPDATE")
    Long lockUser(Long id);

    @Select("SELECT image_revision FROM dress WHERE user_id=#{userId} AND id=#{dressId} FOR UPDATE")
    Long revision(RecognitionWorkRow row);

    @Select("SELECT id FROM dress_image WHERE dress_id=#{dressId} ORDER BY id FOR UPDATE")
    List<Long> lockImages(Long dressId);

    @Select("SELECT * FROM dress_recognition WHERE user_id=#{userId} AND id=#{id} FOR UPDATE")
    RecognitionWorkRow lock(RecognitionWorkRow row);

    @Update(
            "UPDATE dress_recognition SET status='RUNNING',attempt_token=#{attemptToken},started_at=UTC_TIMESTAMP(3),lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND status='PENDING'")
    int claim(RecognitionWorkRow row);

    @Insert(
            "INSERT INTO model_call(user_id,owner_type,owner_id,stage,provider,model,status,started_at,created_at,updated_at) VALUES(#{userId},'DRESS_RECOGNITION',#{id},'RECOGNIZE','DeepSeek',#{model},'SENT',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "currentCallId")
    void call(Map<String, Object> row);

    @Update(
            "UPDATE dress_recognition SET current_call_id=#{currentCallId} WHERE id=#{id} AND attempt_token=#{attemptToken}")
    int bind(RecognitionWorkRow row);

    @Update(
            "UPDATE dress_recognition SET status=#{status},result_snapshot=#{result},error_code=#{code},error_message=#{message},holds_input_assets=#{holds},attempt_token=NULL,lease_until=NULL,finished_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND attempt_token=#{token} AND status='RUNNING'")
    int finish(
            @Param("id") Long id,
            @Param("token") String token,
            @Param("status") String status,
            @Param("result") String result,
            @Param("code") String code,
            @Param("message") String message,
            @Param("holds") int holds);

    @Update(
            "UPDATE model_call SET status=#{status},request_id=#{requestId},error_code=#{code},error_message=#{message},finished_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND owner_type='DRESS_RECOGNITION' AND status='SENT'")
    void finishCall(
            @Param("id") Long id,
            @Param("status") String status,
            @Param("requestId") String requestId,
            @Param("code") String code,
            @Param("message") String message);

    @Update(
            "UPDATE dress_image SET view_type=#{viewType},description=#{description},colors=#{colors},pattern=#{pattern},style_tags=#{styleTags},fit=#{fit},material_description=#{materialDescription},details=#{details},recognition_id=#{recognitionId},updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{userId} AND dress_id=#{dressId} AND id=#{imageId}")
    int features(Map<String, Object> values);
}
