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

    @Select("SELECT COUNT(*) FROM file_asset WHERE status IN ('UPLOADING','VERIFYING')")
    long pendingCount();

    @Select(
            "SELECT COUNT(*) FROM file_asset WHERE user_id=#{userId} AND status IN ('UPLOADING','VERIFYING')")
    long userPendingCount(Long userId);

    @Insert(
            "INSERT INTO file_asset(user_id,bucket,storage_key,original_key,thumbnail_key,original_name,status,expires_at,created_at,updated_at) VALUES(#{userId},#{bucket},#{storageKey},#{originalKey},#{thumbnailKey},#{originalName},'UPLOADING',DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    void insert(FileAssetRow row);

    @Update(
            "UPDATE file_asset SET status='TEMP',storage_key=original_key,thumbnail_key=NULL,mime_type=#{mimeType},size_bytes=#{sizeBytes},width=NULL,height=NULL,validation_error=NULL,verification_token=NULL,verification_lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=#{id} AND user_id=#{userId} AND status IN ('UPLOADING','VERIFYING') AND expires_at>UTC_TIMESTAMP(3) AND cleanup_after IS NULL")
    int complete(FileAssetRow row);

    /** Keep retired immutable objects durable until the ordinary cleanup worker deletes them. */
    @Insert(
            "INSERT INTO file_asset(user_id,bucket,storage_key,thumbnail_key,status,created_at,updated_at) VALUES(#{userId},#{bucket},#{storageKey},#{thumbnailKey},'DELETING',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    void retireDerivatives(FileAssetRow row);

    @Select("SELECT COALESCE(MAX(id),0) FROM file_asset")
    long highestId();

    String FILE_WINDOW = "f.id>#{after} AND f.id<=#{through}";
    String FIRST_FILES = "ORDER BY f.id LIMIT #{limit}";
    String DELETING_FILE = "f.status='DELETING'";
    String EXPIRED_FILE = "f.expires_at<UTC_TIMESTAMP(3)";
    String CLEANUP_DUE = "f.cleanup_after<=UTC_TIMESTAMP(3)";
    // Keep time probes covered by (status, deadline, id). Only VERIFYING needs a lease lookup.
    String WITHOUT_ACTIVE_LEASE =
            """
            (f.status<>'VERIFYING' OR NOT EXISTS (
                SELECT 1 FROM file_asset v WHERE v.id=f.id AND v.verification_lease_until>=UTC_TIMESTAMP(3)))
            """;
    String DUE_FILE_WINDOW = "AND " + FILE_WINDOW + " AND " + WITHOUT_ACTIVE_LEASE + FIRST_FILES;

    @Select({
        """
        WITH candidates AS (
            (SELECT f.id FROM file_asset f FORCE INDEX (idx_file_expiry)
        """,
        "WHERE " + DELETING_FILE + " AND " + FILE_WINDOW + " " + FIRST_FILES + ") UNION",
        """
            (SELECT /*+ SKIP_SCAN(f idx_file_expiry) */ f.id FROM file_asset f FORCE INDEX (idx_file_expiry)
        """,
        "WHERE " + EXPIRED_FILE + " " + DUE_FILE_WINDOW + ") UNION",
        """
            (SELECT /*+ SKIP_SCAN(f idx_file_cleanup) */ f.id FROM file_asset f FORCE INDEX (idx_file_cleanup)
        """,
        "WHERE " + CLEANUP_DUE + " " + DUE_FILE_WINDOW + ")",
        """
            ORDER BY id LIMIT #{limit}
        )
        SELECT f.* FROM candidates c JOIN file_asset f ON f.id=c.id ORDER BY c.id
        """
    })
    List<FileAssetRow> garbage(long after, long through, int limit);

    @Select({
        "SELECT f.* FROM file_asset f FORCE INDEX (PRIMARY) WHERE " + FILE_WINDOW,
        "AND (" + DELETING_FILE + " OR (" + EXPIRED_FILE + " OR " + CLEANUP_DUE + ")",
        "AND " + WITHOUT_ACTIVE_LEASE + ")",
        FIRST_FILES
    })
    List<FileAssetRow> garbageById(long after, long through, int limit);

    @Select("SELECT id FROM user WHERE id=#{user} FOR UPDATE NOWAIT")
    Long lockCleanupUser(Long user);

    @Update(
            "UPDATE file_asset SET cleanup_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL #{delay} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{id} AND status='READY'")
    int scheduleCleanup(Long user, Long id, int delay);

    @Update(
            "UPDATE file_asset SET cleanup_after=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{id} AND status='READY' AND cleanup_after IS NOT NULL")
    int clearCleanup(Long user, Long id);

    @Select(
            "SELECT EXISTS(SELECT 1 FROM user_photo WHERE user_id=#{user} AND asset_id=#{id}) OR EXISTS(SELECT 1 FROM dress_image WHERE user_id=#{user} AND asset_id=#{id})")
    boolean currentInput(Long user, Long id);

    /** A null owner is reserved for the collector's final cross-account check. */
    @Select(
            """
            <script>
            SELECT EXISTS (SELECT 1 FROM user_photo WHERE asset_id=#{id}
                           <if test="user != null">AND user_id=#{user}</if>)
                OR EXISTS (SELECT 1 FROM dress_image WHERE asset_id=#{id}
                           <if test="user != null">AND user_id=#{user}</if>)
                OR EXISTS (SELECT 1 FROM design_task_asset WHERE asset_id=#{id}
                           <if test="user != null">AND user_id=#{user}</if>)
                OR EXISTS (SELECT 1 FROM outfit_item_asset WHERE asset_id=#{id}
                           <if test="user != null">AND user_id=#{user}</if>)
                OR EXISTS (SELECT 1 FROM outfit_plan_asset WHERE asset_id=#{id}
                           <if test="user != null">AND user_id=#{user}</if>)
                OR EXISTS (SELECT 1 FROM `user` WHERE avatar_file_id=#{id}
                           <if test="user != null">AND id=#{user}</if>)
                OR EXISTS (SELECT 1 FROM outfit WHERE source_output_file_id=#{id}
                           <if test="user != null">AND user_id=#{user}</if>)
            </script>
            """)
    boolean hasDirectReference(@Param("user") Long user, @Param("id") Long id);

    @Select(
            "SELECT input_snapshot FROM dress_recognition WHERE user_id=#{userId} AND holds_input_assets=1")
    List<String> recognitionReferences(Long userId);

    @Update(
            "UPDATE file_asset SET status='DELETING',verification_token=NULL,verification_lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=#{id}")
    int deleting(Long id);

    @Delete("DELETE FROM file_asset WHERE id=#{id} AND status='DELETING'")
    int delete(Long id);
}
