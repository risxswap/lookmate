package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.*;
import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface GenerationMapper {
    @Select("SELECT * FROM design_task WHERE user_id=#{user} AND client_request_id=#{key}")
    GenerationTaskRow byKey(Long user, String key);

    @Select("SELECT * FROM design_task WHERE user_id=#{user} AND id=#{id}")
    GenerationTaskRow get(Long user, Long id);

    @Select("SELECT * FROM design_task WHERE user_id=#{user} AND id=#{id} FOR UPDATE")
    GenerationTaskRow lock(Long user, Long id);

    @Select(
            "SELECT COUNT(*) FROM design_task WHERE status IN ('QUEUED','PLANNING','GENERATING','SAVING')")
    long pendingCount();

    @Select(
            "SELECT COUNT(*) FROM design_task WHERE user_id=#{user} AND status IN ('QUEUED','PLANNING','GENERATING','SAVING')")
    long userPending(Long user);

    @Insert(
            "INSERT INTO design_task(user_id,design_type,status,client_request_id,request_hash,input_snapshot,model_config_snapshot,retry_of_task_id,retry_source_id,resume_stage,created_at,updated_at) VALUES(#{userId},#{designType},'QUEUED',#{clientRequestId},#{requestHash},#{inputSnapshot},#{modelConfigSnapshot},#{retryOfTaskId},#{retrySourceId},#{resumeStage},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(GenerationTaskRow row);

    @Update("UPDATE `user` SET active_task_id=#{task},updated_at=UTC_TIMESTAMP(3) WHERE id=#{user}")
    int active(Long user, Long task);

    @Update(
            "UPDATE `user` SET active_task_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=#{user} AND active_task_id=#{task}")
    int release(Long user, Long task);

    @Insert(
            "INSERT INTO design_task_asset(user_id,task_id,asset_id,role,source_dress_id,source_dress_image_id,position,created_at,updated_at) VALUES(#{user},#{task},#{asset},#{role},#{dress},#{image},#{position},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int asset(Long user, Long task, Long asset, String role, Long dress, Long image, int position);

    @Select(
            "SELECT asset_id AS assetId,role,source_dress_id AS dressId,source_dress_image_id AS imageId,position FROM design_task_asset WHERE user_id=#{user} AND task_id=#{task} ORDER BY asset_id,role,position")
    List<Map<String, Object>> assets(Long user, Long task);

    @Select(
            "SELECT * FROM design_task WHERE status='QUEUED' OR (status='SAVING' AND (next_check_at IS NULL OR next_check_at<=UTC_TIMESTAMP(3))) ORDER BY CASE WHEN status='SAVING' THEN 0 ELSE 1 END,created_at,id LIMIT 10")
    List<GenerationTaskRow> pending();

    @Update(
            "UPDATE design_task SET status=#{status},attempt_token=#{token},lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{lease} SECOND),started_at=COALESCE(started_at,UTC_TIMESTAMP(3)),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND status=#{oldStatus} AND (attempt_token IS NULL OR lease_until<UTC_TIMESTAMP(3))")
    int claim(Long id, String oldStatus, String status, String token, int lease);

    @Update(
            "UPDATE design_task SET status=#{status},current_call_id=#{call},lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{lease} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND attempt_token=#{token}")
    int stage(Long id, String token, String status, Long call, int lease);

    @Update(
            "UPDATE design_task SET status=#{status},error_code=#{code},error_message=#{message},outcome_snapshot=#{outcome},attempt_token=NULL,lease_until=NULL,finished_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND attempt_token=#{token}")
    int finish(Long id, String token, String status, String code, String message, String outcome);

    @Update(
            "UPDATE design_task SET status='SAVING',attempt_token=NULL,lease_until=NULL,next_check_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{seconds} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND attempt_token=#{token}")
    int deferSave(Long id, String token, int seconds);

    @Select(
            "SELECT * FROM design_task WHERE status IN ('PLANNING','GENERATING','SAVING') AND lease_until<UTC_TIMESTAMP(3) LIMIT 20")
    List<GenerationTaskRow> expired();

    @Insert(
            "INSERT INTO model_call(user_id,owner_type,owner_id,stage,provider,model,status,started_at,created_at,updated_at) VALUES(#{user},'DESIGN_TASK',#{task},#{stage},#{provider},#{model},'SENT',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int call(Map<String, Object> values);

    @Update(
            "UPDATE model_call SET status=#{status},error_code=#{code},finished_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id}")
    int finishCall(Long id, String status, String code);

    @Select(
            "SELECT id,plan_provenance AS provenance,image_prompt AS prompt FROM design_result WHERE user_id=#{user} AND task_id=#{task}")
    Map<String, Object> result(Long user, Long task);

    @Insert(
            "INSERT INTO design_result(user_id,task_id,title,summary,style,occasion,design_reason,color_advice,wearing_advice,image_prompt,plan_provenance,created_at,updated_at) VALUES(#{user},#{task},#{title},#{summary},#{style},#{occasion},#{designReason},#{colorAdvice},#{wearingAdvice},#{prompt},#{provenance},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int resultInsert(Map<String, Object> values);

    @Insert(
            "INSERT INTO design_result_item(user_id,result_id,dress_id,dress_name,category_name,match_reason,wearing_method,sort_order,created_at,updated_at) VALUES(#{user},#{result},#{dressId},#{name},#{categoryName},#{matchReason},#{wearingMethod},#{position},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int item(Map<String, Object> values);

    @Insert(
            "INSERT INTO design_result_hairstyle(user_id,result_id,hairstyle_name,length_advice,bangs_advice,parting_advice,texture_advice,hair_color_advice,care_advice,created_at,updated_at) VALUES(#{user},#{result},#{hairstyleName},#{lengthAdvice},#{bangsAdvice},#{partingAdvice},#{textureAdvice},#{hairColorAdvice},#{careAdvice},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int hairstyle(Map<String, Object> values);

    @Select(
            "SELECT t.id AS taskId,t.retry_source_id AS retrySourceId,t.resume_stage AS resumeStage,r.plan_provenance AS provenance,r.style,r.occasion FROM design_task t JOIN design_result r ON r.task_id=t.id AND r.user_id=t.user_id WHERE t.user_id=#{user} AND t.status='SUCCEEDED' AND t.hidden_at IS NULL AND t.design_type IN ('OUTFIT','OVERALL') ORDER BY t.created_at DESC,t.id DESC LIMIT #{limit}")
    List<Map<String, Object>> recent(Long user, int limit);

    @Insert(
            "INSERT INTO file_asset(user_id,bucket,storage_key,thumbnail_key,mime_type,size_bytes,width,height,status,created_at,updated_at) VALUES(#{userId},#{bucket},#{storageKey},#{thumbnailKey},'image/jpeg',#{sizeBytes},#{width},#{height},'READY',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int output(FileAssetRow file);

    @Update(
            "UPDATE design_task SET lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{lease} SECOND) WHERE id=#{id} AND attempt_token=#{token} AND status IN ('PLANNING','GENERATING','SAVING')")
    int renew(Long id, String token, int lease);
}
