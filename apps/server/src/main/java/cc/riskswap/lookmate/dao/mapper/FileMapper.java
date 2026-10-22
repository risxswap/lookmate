package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.FileAssetRow;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface FileMapper {
    @Select("SELECT id FROM user WHERE id=#{userId} FOR UPDATE")
    Long lockUser(Long userId);

    @Select("SELECT *,UTC_TIMESTAMP(3) db_now FROM file_asset WHERE user_id=#{userId} AND id=#{id}")
    FileAssetRow find(@Param("userId") Long userId, @Param("id") Long id);

    @Select(
            "SELECT *,UTC_TIMESTAMP(3) db_now FROM file_asset WHERE user_id=#{userId} AND id=#{id} FOR UPDATE")
    FileAssetRow lock(@Param("userId") Long userId, @Param("id") Long id);

    @Update(
            "UPDATE file_asset SET verification_lease_until=NULL WHERE id=#{id} AND status IN ('UPLOADING','VERIFYING') AND verification_token IS NULL")
    int notifyComplete(Long id);

    @Select("SELECT COUNT(*) FROM file_asset WHERE status IN ('UPLOADING','VERIFYING')")
    long pendingCount();

    @Select(
            "SELECT COUNT(*) FROM file_asset WHERE user_id=#{userId} AND status IN ('UPLOADING','VERIFYING')")
    long userPendingCount(Long userId);

    @Insert(
            "INSERT INTO file_asset(user_id,bucket,storage_key,original_key,thumbnail_key,original_name,status,expires_at,created_at,updated_at) VALUES(#{userId},#{bucket},#{storageKey},#{originalKey},#{thumbnailKey},#{originalName},'UPLOADING',DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    void insert(FileAssetRow row);

    @Select(
            "SELECT * FROM file_asset WHERE status IN ('UPLOADING','VERIFYING') AND expires_at>UTC_TIMESTAMP(3) AND (verification_lease_until IS NULL OR verification_lease_until<UTC_TIMESTAMP(3)) ORDER BY COALESCE(verification_lease_until,created_at),id LIMIT 10")
    List<FileAssetRow> candidates();

    @Update(
            "UPDATE file_asset SET status='VERIFYING',verification_token=#{token},verification_lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{leaseSeconds} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND status IN ('UPLOADING','VERIFYING') AND expires_at>UTC_TIMESTAMP(3) AND (verification_lease_until IS NULL OR verification_lease_until<UTC_TIMESTAMP(3))")
    int claim(
            @Param("id") Long id,
            @Param("token") String token,
            @Param("leaseSeconds") int leaseSeconds);

    @Update(
            "UPDATE file_asset SET status='TEMP',mime_type='image/jpeg',size_bytes=#{sizeBytes},width=#{width},height=#{height},verification_token=NULL,verification_lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND status='VERIFYING' AND verification_token=#{verificationToken}")
    int ready(FileAssetRow row);

    @Update(
            "UPDATE file_asset SET status='REJECTED',validation_error=#{message},cleanup_after=UTC_TIMESTAMP(3),verification_token=NULL,verification_lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND verification_token=#{token}")
    int reject(
            @Param("id") Long id, @Param("token") String token, @Param("message") String message);

    @Update(
            "UPDATE file_asset SET verification_token=NULL,verification_lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{retrySeconds} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND verification_token=#{token}")
    int defer(
            @Param("id") Long id,
            @Param("token") String token,
            @Param("retrySeconds") int retrySeconds);

    @Select(
            "SELECT * FROM file_asset WHERE status='DELETING' OR (status!='VERIFYING' OR verification_lease_until<UTC_TIMESTAMP(3)) AND ((expires_at IS NOT NULL AND expires_at<UTC_TIMESTAMP(3)) OR cleanup_after<=UTC_TIMESTAMP(3)) ORDER BY updated_at,id LIMIT 10")
    List<FileAssetRow> garbage();

    @Select(
            "SELECT (SELECT COUNT(*) FROM user_photo WHERE asset_id=#{id})+(SELECT COUNT(*) FROM dress_image WHERE asset_id=#{id})+(SELECT COUNT(*) FROM design_task_asset WHERE asset_id=#{id})+(SELECT COUNT(*) FROM outfit_item_asset WHERE asset_id=#{id})")
    long directReferences(Long id);

    @Select(
            "SELECT input_snapshot FROM dress_recognition WHERE user_id=#{userId} AND holds_input_assets=1")
    List<String> recognitionReferences(Long userId);

    @Update(
            "UPDATE file_asset SET status='DELETING',verification_token=NULL,verification_lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=#{id}")
    int deleting(Long id);

    @Delete("DELETE FROM file_asset WHERE id=#{id} AND status='DELETING'")
    int delete(Long id);
}
