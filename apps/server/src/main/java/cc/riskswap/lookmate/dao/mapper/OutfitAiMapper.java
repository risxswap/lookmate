package cc.riskswap.lookmate.dao.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OutfitAiMapper {
    @Insert(
            "INSERT INTO outfit_ai_job(user_id,task_id,outfit_id,revision,kind,created_at,updated_at) VALUES(#{user},#{task},#{outfit},#{revision},#{kind},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int insert(Long user, Long task, Long outfit, Long revision, String kind);

    @Select(
            "SELECT task_id AS taskId,outfit_id AS outfitId,revision,kind FROM outfit_ai_job WHERE user_id=#{user} AND task_id=#{task}")
    Map<String, Object> get(Long user, Long task);

    @Select(
            "SELECT j.task_id FROM outfit_ai_job j JOIN design_task t ON t.id=j.task_id AND t.user_id=j.user_id WHERE j.user_id=#{user} AND j.outfit_id=#{outfit} AND t.hidden_at IS NULL ORDER BY j.created_at DESC,j.id DESC LIMIT #{size} OFFSET #{offset}")
    List<Long> list(Long user, Long outfit, int size, long offset);

    @Select(
            "SELECT COUNT(*) FROM outfit_ai_job j JOIN design_task t ON t.id=j.task_id AND t.user_id=j.user_id WHERE j.user_id=#{user} AND j.outfit_id=#{outfit} AND t.hidden_at IS NULL")
    long count(Long user, Long outfit);

    @Select("SELECT revision FROM outfit WHERE user_id=#{user} AND id=#{outfit}")
    Long revision(Long user, Long outfit);
}
