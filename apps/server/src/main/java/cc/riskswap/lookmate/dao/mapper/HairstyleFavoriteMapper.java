package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.HairstyleFavoriteRow;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface HairstyleFavoriteMapper {
    String FILTER =
            """
        FROM hairstyle_favorite WHERE user_id = #{userId} AND (
        <choose><when test='matchingIds.size() > 0'>hairstyle_id IN
          <foreach collection='matchingIds' item='style' open='(' separator=',' close=')'>#{style}</foreach>
        </when><otherwise>1 = 0</otherwise></choose>
        OR (
        <choose><when test='activeIds.size() > 0'>hairstyle_id NOT IN
          <foreach collection='activeIds' item='style' open='(' separator=',' close=')'>#{style}</foreach>
        </when><otherwise>1 = 1</otherwise></choose>
        <if test='length != null'>AND JSON_UNQUOTE(JSON_EXTRACT(display_snapshot, '$.length')) = #{length}</if>
        <if test='bangs != null'>AND JSON_UNQUOTE(JSON_EXTRACT(display_snapshot, '$.bangs')) = #{bangs}</if>
        <if test='texture != null'>AND JSON_UNQUOTE(JSON_EXTRACT(display_snapshot, '$.texture')) = #{texture}</if>
        ))
        """;

    @Select(
            "<script>SELECT id, hairstyle_id, display_snapshot, created_at "
                    + FILTER
                    + " ORDER BY created_at DESC, id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<HairstyleFavoriteRow> page(
            Long userId,
            List<String> activeIds,
            List<String> matchingIds,
            String length,
            String bangs,
            String texture,
            int size,
            long offset);

    @Select("<script>SELECT COUNT(*) " + FILTER + "</script>")
    long count(
            Long userId,
            List<String> activeIds,
            List<String> matchingIds,
            String length,
            String bangs,
            String texture);

    @Select(
            "SELECT id, hairstyle_id, display_snapshot, created_at FROM hairstyle_favorite WHERE user_id=#{userId} AND hairstyle_id=#{styleId}")
    HairstyleFavoriteRow find(Long userId, String styleId);

    @Select(
            "<script>SELECT id, hairstyle_id, created_at FROM hairstyle_favorite WHERE user_id=#{userId} AND hairstyle_id IN <foreach collection='ids' item='style' open='(' separator=',' close=')'>#{style}</foreach></script>")
    List<HairstyleFavoriteRow> findPage(Long userId, List<String> ids);

    @Select("SELECT id FROM `user` WHERE id=#{userId} FOR UPDATE")
    Long lockUser(Long userId);

    @Insert(
            "INSERT INTO hairstyle_favorite(user_id,hairstyle_id,display_snapshot,created_at,updated_at) VALUES(#{userId},#{styleId},#{snapshot},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int insert(Long userId, String styleId, String snapshot);

    @Delete("DELETE FROM hairstyle_favorite WHERE user_id=#{userId} AND hairstyle_id=#{styleId}")
    int delete(Long userId, String styleId);
}
