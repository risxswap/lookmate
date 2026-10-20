package cc.riskswap.lookmate.mapper;

import java.util.List;
import cc.riskswap.lookmate.dto.DesignResultDto;
import cc.riskswap.lookmate.dto.HairstyleDto;
import cc.riskswap.lookmate.dto.ResultItemDto;
import cc.riskswap.lookmate.entity.TaskQueryRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface DesignQueryMapper {
    String TASK_COLUMNS = """
            SELECT t.id, t.design_type, t.status, t.created_at, t.updated_at,
                   r.id AS result_id, f.id AS favorite_id, r.title, r.summary, t.error_code, t.error_message
            FROM design_task t
            LEFT JOIN design_result r ON r.task_id = t.id AND r.user_id = t.user_id
            LEFT JOIN design_favorite f ON f.result_id = r.id AND f.user_id = t.user_id
            WHERE t.user_id = #{userId} AND t.hidden_at IS NULL
            """;

    @Select(TASK_COLUMNS + """
            AND t.status IN ('QUEUED', 'PLANNING', 'GENERATING', 'SAVING')
            ORDER BY t.created_at DESC, t.id DESC LIMIT 1
            """)
    TaskQueryRow findActive(@Param("userId") Long userId);

    @Select(TASK_COLUMNS + """
            AND t.status IN ('SUCCEEDED', 'FAILED', 'UNKNOWN')
            ORDER BY t.created_at DESC, t.id DESC LIMIT 6
            """)
    List<TaskQueryRow> findRecent(@Param("userId") Long userId);

    @Select(TASK_COLUMNS + "AND t.id = #{taskId}")
    TaskQueryRow findTask(@Param("userId") Long userId, @Param("taskId") Long taskId);

    @Select("""
            SELECT CAST(id AS CHAR) AS id, title, summary, style, occasion,
                   design_reason, color_advice, wearing_advice
            FROM design_result WHERE task_id = #{taskId} AND user_id = #{userId}
            """)
    DesignResultDto findResult(@Param("userId") Long userId, @Param("taskId") Long taskId);

    @Select("""
            SELECT hairstyle_name, length_advice, bangs_advice, parting_advice,
                   texture_advice, hair_color_advice, care_advice
            FROM design_result_hairstyle WHERE result_id = #{resultId} AND user_id = #{userId}
            """)
    HairstyleDto findHairstyle(@Param("userId") Long userId, @Param("resultId") Long resultId);

    @Select("""
            SELECT CAST(dress_id AS CHAR) AS dress_id, dress_name, category_name, match_reason, wearing_method
            FROM design_result_item WHERE result_id = #{resultId} AND user_id = #{userId}
            ORDER BY sort_order ASC, id ASC
            """)
    List<ResultItemDto> findItems(@Param("userId") Long userId, @Param("resultId") Long resultId);
}
