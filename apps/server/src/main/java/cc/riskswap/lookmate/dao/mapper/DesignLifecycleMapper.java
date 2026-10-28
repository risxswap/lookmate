package cc.riskswap.lookmate.dao.mapper;

import org.apache.ibatis.annotations.*;

@Mapper
public interface DesignLifecycleMapper {
    @Update(
            "UPDATE design_task SET hidden_at=COALESCE(hidden_at,UTC_TIMESTAMP(3)),purge_after=COALESCE(purge_after,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY)),updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{task}")
    int hide(Long user, Long task);

    @Select(
            "SELECT * FROM design_task WHERE hidden_at IS NOT NULL AND (status IN ('SUCCEEDED','FAILED') OR purge_after<=UTC_TIMESTAMP(3)) ORDER BY purge_after,id LIMIT 20")
    java.util.List<cc.riskswap.lookmate.dao.entity.GenerationTaskRow> purgeCandidates();

    @Select(
            "SELECT COUNT(*) FROM design_task WHERE user_id=#{user} AND id=#{task} AND hidden_at IS NOT NULL AND (status IN ('SUCCEEDED','FAILED') OR purge_after<=UTC_TIMESTAMP(3))")
    int purgeable(Long user, Long task);

    @Select(
            "SELECT DISTINCT asset_id FROM design_task_asset WHERE user_id=#{user} AND task_id=#{task} ORDER BY asset_id")
    java.util.List<Long> assets(Long user, Long task);

    @Delete(
            "DELETE FROM favorite_folder_item WHERE user_id=#{user} AND design_favorite_id IN (SELECT f.id FROM design_favorite f JOIN design_result r ON r.id=f.result_id WHERE r.task_id=#{task} AND r.user_id=#{user})")
    int folderItems(Long user, Long task);

    @Delete(
            "DELETE FROM design_favorite WHERE user_id=#{user} AND result_id IN (SELECT id FROM design_result WHERE task_id=#{task} AND user_id=#{user})")
    int favorites(Long user, Long task);

    @Delete(
            "DELETE FROM design_result_item WHERE user_id=#{user} AND result_id IN (SELECT id FROM design_result WHERE task_id=#{task} AND user_id=#{user})")
    int items(Long user, Long task);

    @Delete(
            "DELETE FROM design_result_hairstyle WHERE user_id=#{user} AND result_id IN (SELECT id FROM design_result WHERE task_id=#{task} AND user_id=#{user})")
    int hair(Long user, Long task);

    @Delete("DELETE FROM design_result WHERE user_id=#{user} AND task_id=#{task}")
    int result(Long user, Long task);

    @Delete("DELETE FROM design_task_asset WHERE user_id=#{user} AND task_id=#{task}")
    int references(Long user, Long task);

    @Delete(
            "DELETE FROM model_call WHERE user_id=#{user} AND owner_type='DESIGN_TASK' AND owner_id=#{task}")
    int calls(Long user, Long task);

    @Delete("DELETE FROM outfit_ai_job WHERE user_id=#{user} AND task_id=#{task}")
    int jobs(Long user, Long task);

    @Delete("DELETE FROM design_task WHERE user_id=#{user} AND id=#{task}")
    int task(Long user, Long task);

    @Update(
            "UPDATE design_task SET retry_of_task_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND retry_of_task_id=#{task}")
    int detachRetries(Long user, Long task);

    @Update(
            "UPDATE file_asset SET cleanup_after=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{user} AND id=#{task}")
    int scheduleFile(Long user, Long task);
}
