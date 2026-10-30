package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.OutfitInspirationFavoriteRow;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OutfitInspirationFavoriteMapper {
    String FILTER =
            """
        FROM outfit_inspiration_favorite WHERE user_id = #{userId} AND (
        <choose><when test='matchingIds.size() > 0'>inspiration_id IN
          <foreach collection='matchingIds' item='style' open='(' separator=',' close=')'>#{style}</foreach>
        </when><otherwise>1 = 0</otherwise></choose>
        OR (
        <choose><when test='activeIds.size() > 0'>inspiration_id NOT IN
          <foreach collection='activeIds' item='style' open='(' separator=',' close=')'>#{style}</foreach>
        </when><otherwise>1 = 1</otherwise></choose>
        <if test='occasion != null'>AND JSON_CONTAINS(JSON_EXTRACT(display_snapshot, '$.occasions'), JSON_QUOTE(#{occasion}))</if>
        <if test='style != null'>AND JSON_CONTAINS(JSON_EXTRACT(display_snapshot, '$.styles'), JSON_QUOTE(#{style}))</if>
        ))
        """;

    @Select(
            "<script>SELECT id, inspiration_id, display_snapshot, created_at "
                    + FILTER
                    + " ORDER BY created_at DESC, id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<OutfitInspirationFavoriteRow> page(
            Long userId,
            List<String> activeIds,
            List<String> matchingIds,
            String occasion,
            String style,
            int size,
            long offset);

    @Select("<script>SELECT COUNT(*) " + FILTER + "</script>")
    long count(
            Long userId,
            List<String> activeIds,
            List<String> matchingIds,
            String occasion,
            String style);

    @Select(
            "SELECT id, inspiration_id, display_snapshot, created_at FROM outfit_inspiration_favorite WHERE user_id=#{userId} AND inspiration_id=#{styleId}")
    OutfitInspirationFavoriteRow find(Long userId, String styleId);

    @Select(
            "<script>SELECT id, inspiration_id, created_at FROM outfit_inspiration_favorite WHERE user_id=#{userId} AND inspiration_id IN <foreach collection='ids' item='style' open='(' separator=',' close=')'>#{style}</foreach></script>")
    List<OutfitInspirationFavoriteRow> findPage(Long userId, List<String> ids);

    @Select("SELECT id FROM `user` WHERE id=#{userId} FOR UPDATE")
    Long lockUser(Long userId);

    @Insert(
            "INSERT INTO outfit_inspiration_favorite(user_id,inspiration_id,display_snapshot,created_at,updated_at) VALUES(#{userId},#{styleId},#{snapshot},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int insert(Long userId, String styleId, String snapshot);

    @Delete(
            "DELETE FROM outfit_inspiration_favorite WHERE user_id=#{userId} AND inspiration_id=#{styleId}")
    int delete(Long userId, String styleId);
}
