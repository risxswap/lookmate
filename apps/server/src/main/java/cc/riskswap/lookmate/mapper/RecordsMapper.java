package cc.riskswap.lookmate.mapper;

import java.util.List;
import cc.riskswap.lookmate.entity.CollectionRow;
import cc.riskswap.lookmate.entity.FavoriteRow;
import cc.riskswap.lookmate.entity.TaskQueryRow;
import org.apache.ibatis.annotations.*;

@Mapper
public interface RecordsMapper {
    String FILTER = "<if test='type != null'> AND t.design_type = #{type}</if><if test='status != null'> AND t.status = #{status}</if>";
    String FAVORITES = """
            FROM design_favorite f JOIN design_result r ON r.id = f.result_id AND r.user_id = f.user_id
            JOIN design_task t ON t.id = r.task_id AND t.user_id = f.user_id AND t.hidden_at IS NULL
            WHERE f.user_id = #{userId}
            <if test='collectionId != null'> AND EXISTS (SELECT 1 FROM favorite_folder_item i
                JOIN favorite_folder c ON c.id = i.favorite_folder_id AND c.user_id = i.user_id
                WHERE i.design_favorite_id = f.id AND i.user_id = #{userId} AND i.favorite_folder_id = #{collectionId})</if>
            """;

    @Select("<script>" + DesignQueryMapper.TASK_COLUMNS + FILTER + " ORDER BY t.created_at DESC, t.id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<TaskQueryRow> designs(Long userId, String type, String status, int size, long offset);

    @Select("<script>SELECT COUNT(*) FROM design_task t WHERE t.user_id = #{userId} AND t.hidden_at IS NULL " + FILTER + "</script>")
    long designCount(Long userId, String type, String status);

    @Select("<script>SELECT f.id, f.result_id, r.task_id, f.created_at " + FAVORITES + " ORDER BY f.created_at DESC, f.id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<FavoriteRow> favorites(Long userId, Long collectionId, int size, long offset);

    @Select("<script>SELECT COUNT(*) " + FAVORITES + "</script>")
    long favoriteCount(Long userId, Long collectionId);

    @Select("<script>" + DesignQueryMapper.TASK_COLUMNS + " AND t.id IN <foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach></script>")
    List<TaskQueryRow> tasks(Long userId, List<Long> ids);

    @Select("""
            <script>SELECT i.design_favorite_id AS favorite_id, c.id AS collection_id FROM favorite_folder_item i
            JOIN favorite_folder c ON c.id = i.favorite_folder_id AND c.user_id = i.user_id
            WHERE i.user_id = #{userId} AND i.design_favorite_id IN
            <foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach>
            ORDER BY c.id</script>
            """)
    List<cc.riskswap.lookmate.entity.MembershipRow> memberships(Long userId, List<Long> ids);

    @Select("SELECT id, name, version, created_at, updated_at FROM favorite_folder WHERE user_id = #{userId} ORDER BY created_at DESC, id DESC LIMIT #{size} OFFSET #{offset}")
    List<CollectionRow> collections(Long userId, int size, long offset);

    @Select("SELECT COUNT(*) FROM favorite_folder WHERE user_id = #{userId}")
    long collectionCount(Long userId);

    @Select("SELECT id FROM `user` WHERE id = #{userId} FOR UPDATE")
    Long lockUser(Long userId);

    @Select("SELECT id, name, version, created_at, updated_at FROM favorite_folder WHERE user_id = #{userId} AND id = #{id}")
    CollectionRow collection(Long userId, Long id);

    @Select("SELECT id FROM favorite_folder WHERE user_id = #{userId} AND name = #{name} AND id != #{excludedId}")
    Long duplicateName(Long userId, String name, Long excludedId);

    @Insert("INSERT INTO favorite_folder (user_id,name,version,created_at,updated_at) VALUES (#{userId},#{row.name},0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "row.id")
    int createCollection(Long userId, CollectionRow row);

    @Update("UPDATE favorite_folder SET name = #{name}, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE user_id = #{userId} AND id = #{id} AND version = #{version}")
    int renameCollection(Long userId, Long id, String name, Long version);

    @Delete("DELETE FROM favorite_folder_item WHERE user_id = #{userId} AND favorite_folder_id = #{id}")
    int deleteCollectionItems(Long userId, Long id);

    @Delete("DELETE FROM favorite_folder WHERE user_id = #{userId} AND id = #{id}")
    int deleteCollection(Long userId, Long id);

    @Select(DesignQueryMapper.TASK_COLUMNS + " AND r.id = #{resultId}")
    TaskQueryRow resultTask(Long userId, Long resultId);

    @Select("""
            SELECT f.id, f.result_id, r.task_id, f.created_at FROM design_favorite f
            JOIN design_result r ON r.id = f.result_id AND r.user_id = f.user_id
            JOIN design_task t ON t.id = r.task_id AND t.user_id = f.user_id AND t.hidden_at IS NULL
            WHERE f.user_id = #{userId} AND f.id = #{id}
            """)
    FavoriteRow favorite(Long userId, Long id);

    @Insert("INSERT INTO design_favorite (user_id,result_id,created_at,updated_at) VALUES (#{userId},#{resultId},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int createFavorite(Long userId, Long resultId);

    @Delete("DELETE FROM favorite_folder_item WHERE user_id = #{userId} AND design_favorite_id = #{id}")
    int deleteFavoriteItems(Long userId, Long id);

    @Delete("DELETE FROM design_favorite WHERE user_id = #{userId} AND id = #{id}")
    int deleteFavorite(Long userId, Long id);

    @Select("""
            SELECT CAST(c.id AS CHAR) FROM favorite_folder_item i
            JOIN favorite_folder c ON c.id = i.favorite_folder_id AND c.user_id = i.user_id
            WHERE i.user_id = #{userId} AND i.design_favorite_id = #{favoriteId} ORDER BY c.id
            """)
    List<String> collectionIds(Long userId, Long favoriteId);

    @Select("SELECT id FROM favorite_folder_item WHERE user_id = #{userId} AND favorite_folder_id = #{collectionId} AND design_favorite_id = #{favoriteId}")
    Long membership(Long userId, Long collectionId, Long favoriteId);

    @Insert("INSERT INTO favorite_folder_item (user_id,favorite_folder_id,design_favorite_id,created_at,updated_at) VALUES (#{userId},#{collectionId},#{favoriteId},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int addItem(Long userId, Long collectionId, Long favoriteId);

    @Delete("DELETE FROM favorite_folder_item WHERE user_id = #{userId} AND favorite_folder_id = #{collectionId} AND design_favorite_id = #{favoriteId}")
    int removeItem(Long userId, Long collectionId, Long favoriteId);
}
