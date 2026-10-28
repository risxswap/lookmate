package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.*;
import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OutfitMapper {
    @Select("SELECT * FROM outfit WHERE user_id=#{user} AND id=#{id}")
    OutfitRow get(Long user, Long id);

    @Select(
            "<script>SELECT o.* FROM outfit o WHERE o.user_id=#{user}<if test='groupId != null'> AND EXISTS(SELECT 1 FROM outfit_group_member m WHERE m.user_id=o.user_id AND m.outfit_id=o.id AND m.group_id=#{groupId})</if><if test='scene != null'> AND EXISTS(SELECT 1 FROM outfit_scene s WHERE s.user_id=o.user_id AND s.outfit_id=o.id AND s.name=#{scene})</if> ORDER BY o.pinned DESC,o.created_at DESC,o.id DESC LIMIT #{limit} OFFSET #{offset}</script>")
    List<OutfitRow> list(Long user, Long groupId, String scene, int limit, long offset);

    @Select(
            "<script>SELECT COUNT(*) FROM outfit o WHERE o.user_id=#{user}<if test='groupId != null'> AND EXISTS(SELECT 1 FROM outfit_group_member m WHERE m.user_id=o.user_id AND m.outfit_id=o.id AND m.group_id=#{groupId})</if><if test='scene != null'> AND EXISTS(SELECT 1 FROM outfit_scene s WHERE s.user_id=o.user_id AND s.outfit_id=o.id AND s.name=#{scene})</if></script>")
    long count(Long user, Long groupId, String scene);

    @Insert(
            "INSERT INTO outfit(user_id,name,note,pinned,source_design_id,source_output_file_id,created_at,updated_at) VALUES(#{userId},#{name},#{note},#{pinned},#{sourceDesignId},#{sourceOutputFileId},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(OutfitRow row);

    @Update(
            "UPDATE outfit SET name=#{name},note=#{note},pinned=#{pinned},version=version+1,revision=#{revision},updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{userId} AND id=#{id} AND version=#{version}")
    int update(OutfitRow row);

    @Delete("DELETE FROM outfit WHERE user_id=#{user} AND id=#{id}")
    int delete(Long user, Long id);

    @Select(
            "SELECT i.*, (d.id IS NULL) missing FROM outfit_item i LEFT JOIN dress d ON d.id=i.dress_id AND d.user_id=i.user_id WHERE i.user_id=#{user} AND i.outfit_id=#{id} ORDER BY i.position,i.id")
    List<OutfitItemRow> items(Long user, Long id);

    @Insert(
            "INSERT INTO outfit_item(user_id,outfit_id,dress_id,position,snapshot,created_at,updated_at) VALUES(#{userId},#{outfitId},#{dressId},#{position},#{snapshot},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int insertItem(OutfitItemRow item);

    @Delete("DELETE FROM outfit_item WHERE user_id=#{user} AND outfit_id=#{id}")
    int deleteItems(Long user, Long id);

    @Select(
            "SELECT asset_id FROM outfit_item_asset WHERE user_id=#{user} AND outfit_id=#{id} ORDER BY asset_id")
    List<Long> assets(Long user, Long id);

    @Insert(
            "INSERT INTO outfit_item_asset(user_id,outfit_id,asset_id,created_at,updated_at) VALUES(#{user},#{id},#{asset},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int asset(Long user, Long id, Long asset);

    @Delete("DELETE FROM outfit_item_asset WHERE user_id=#{user} AND outfit_id=#{id}")
    int deleteAssets(Long user, Long id);

    @Select("SELECT * FROM outfit_group WHERE user_id=#{user} AND id=#{id}")
    OutfitGroupRow group(Long user, Long id);

    @Select(
            "SELECT * FROM outfit_group WHERE user_id=#{user} ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}")
    List<OutfitGroupRow> groups(Long user, int limit, long offset);

    @Select("SELECT COUNT(*) FROM outfit_group WHERE user_id=#{user}")
    long groupCount(Long user);

    @Select(
            "SELECT g.* FROM outfit_group g JOIN outfit_group_member m ON m.group_id=g.id AND m.user_id=g.user_id WHERE m.user_id=#{user} AND m.outfit_id=#{id} ORDER BY g.created_at DESC,g.id DESC")
    List<OutfitGroupRow> memberships(Long user, Long id);

    @Insert(
            "INSERT INTO outfit_group(user_id,name,created_at,updated_at) VALUES(#{userId},#{name},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insertGroup(OutfitGroupRow row);

    @Update(
            "UPDATE outfit_group SET name=#{name},version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{userId} AND id=#{id} AND version=#{version}")
    int updateGroup(OutfitGroupRow row);

    @Insert(
            "INSERT INTO outfit_group_member(user_id,outfit_id,group_id,created_at,updated_at) VALUES(#{user},#{id},#{group},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int member(Long user, Long id, Long group);

    @Delete("DELETE FROM outfit_group_member WHERE user_id=#{user} AND outfit_id=#{id}")
    int deleteMembers(Long user, Long id);

    @Select(
            "SELECT o.* FROM outfit o JOIN outfit_group_member m ON m.outfit_id=o.id AND m.user_id=o.user_id WHERE m.user_id=#{user} AND m.group_id=#{id} ORDER BY o.id")
    List<OutfitRow> groupOutfits(Long user, Long id);

    @Delete("DELETE FROM outfit_group_member WHERE user_id=#{user} AND group_id=#{id}")
    int unlinkGroup(Long user, Long id);

    @Delete("DELETE FROM outfit_group WHERE user_id=#{user} AND id=#{id}")
    int deleteGroup(Long user, Long id);

    @Select(
            "SELECT t.input_snapshot AS inputSnapshot,r.title,r.wearing_advice AS wearingAdvice FROM design_task t JOIN design_result r ON r.task_id=t.id AND r.user_id=t.user_id WHERE t.user_id=#{user} AND t.id=#{id} AND t.status='SUCCEEDED' AND t.design_type IN ('OUTFIT','OVERALL') AND t.hidden_at IS NULL AND EXISTS(SELECT 1 FROM design_task_asset a WHERE a.user_id=t.user_id AND a.task_id=t.id AND a.role='OUTPUT')")
    Map<String, Object> source(Long user, Long id);

    @Select(
            "SELECT i.dress_id FROM design_result_item i JOIN design_result r ON i.result_id=r.id AND i.user_id=r.user_id WHERE r.user_id=#{user} AND r.task_id=#{id} ORDER BY i.sort_order,i.id")
    List<Long> sourceItems(Long user, Long id);

    @Select(
            "SELECT asset_id FROM design_task_asset WHERE user_id=#{user} AND task_id=#{id} AND role='OUTPUT' ORDER BY id LIMIT 1")
    Long sourceOutput(Long user, Long id);

    @Select("SELECT name FROM outfit_scene WHERE user_id=#{user} AND outfit_id=#{id} ORDER BY id")
    List<String> scenes(Long user, Long id);

    @Delete("DELETE FROM outfit_scene WHERE user_id=#{user} AND outfit_id=#{id}")
    int deleteScenes(Long user, Long id);

    @Insert(
            "INSERT INTO outfit_scene(user_id,outfit_id,name,created_at,updated_at) VALUES(#{user},#{id},#{name},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int scene(Long user, Long id, String name);

    @Insert(
            "INSERT INTO outfit_scene_option(user_id,name,created_at,updated_at) VALUES(#{user},#{name},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE name=VALUES(name)")
    int rememberScene(Long user, String name);

    @Select(
            "SELECT name FROM outfit_scene_option WHERE user_id=#{user} ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}")
    List<String> sceneOptions(Long user, int limit, long offset);

    @Select("SELECT COUNT(*) FROM outfit_scene_option WHERE user_id=#{user}")
    long sceneOptionCount(Long user);
}
