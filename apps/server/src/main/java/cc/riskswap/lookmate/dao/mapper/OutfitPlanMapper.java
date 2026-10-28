package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.OutfitPlanRow;
import java.time.LocalDate;
import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OutfitPlanMapper {
    @Select("SELECT * FROM outfit_plan WHERE user_id=#{user} AND id=#{id}")
    OutfitPlanRow get(Long user, Long id);

    @Select("SELECT * FROM outfit_plan WHERE user_id=#{user} AND client_request_id=#{key}")
    OutfitPlanRow byRequest(Long user, String key);

    @Select(
            "SELECT * FROM outfit_plan WHERE user_id=#{user} AND plan_date=#{date} ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}")
    List<OutfitPlanRow> list(Long user, LocalDate date, int limit, long offset);

    @Select("SELECT COUNT(*) FROM outfit_plan WHERE user_id=#{user} AND plan_date=#{date}")
    long count(Long user, LocalDate date);

    @Select(
            "SELECT CAST(plan_date AS CHAR) AS date,COUNT(*) AS count FROM outfit_plan WHERE user_id=#{user} AND plan_date BETWEEN #{from} AND #{to} GROUP BY plan_date ORDER BY plan_date")
    List<Map<String, Object>> calendar(Long user, LocalDate from, LocalDate to);

    @Insert(
            "INSERT INTO outfit_plan(user_id,plan_date,scene,note,source_outfit_id,snapshot,client_request_id,request_hash,created_at,updated_at) VALUES(#{userId},#{planDate},#{scene},#{note},#{sourceOutfitId},#{snapshot},#{clientRequestId},#{requestHash},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(OutfitPlanRow row);

    @Update(
            "UPDATE outfit_plan SET plan_date=#{planDate},scene=#{scene},note=#{note},source_outfit_id=#{sourceOutfitId},snapshot=#{snapshot},version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{userId} AND id=#{id} AND version=#{version}")
    int update(OutfitPlanRow row);

    @Delete("DELETE FROM outfit_plan WHERE user_id=#{user} AND id=#{id}")
    int delete(Long user, Long id);

    @Select(
            "SELECT asset_id FROM outfit_plan_asset WHERE user_id=#{user} AND plan_id=#{id} ORDER BY asset_id")
    List<Long> assets(Long user, Long id);

    @Insert(
            "INSERT INTO outfit_plan_asset(user_id,plan_id,asset_id,created_at,updated_at) VALUES(#{user},#{id},#{asset},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int asset(Long user, Long id, Long asset);

    @Delete("DELETE FROM outfit_plan_asset WHERE user_id=#{user} AND plan_id=#{id}")
    int deleteAssets(Long user, Long id);
}
