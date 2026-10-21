package cc.riskswap.lookmate.mapper;

import cc.riskswap.lookmate.entity.PreferenceRow;
import org.apache.ibatis.annotations.*;

@Mapper
public interface PreferenceMapper {
    @Select("SELECT * FROM user_preference WHERE user_id=#{user}")
    PreferenceRow get(Long user);

    @Insert(
            "INSERT INTO user_preference(user_id,interests,styles,preferred_colors,avoided_colors,fits,hair_lengths,restrictions,dye_acceptance,perm_acceptance,grooming_effort,outfit_note,hair_note,restriction_note,created_at,updated_at) VALUES(#{userId},#{interests},#{styles},#{preferredColors},#{avoidedColors},#{fits},#{hairLengths},#{restrictions},#{dyeAcceptance},#{permAcceptance},#{groomingEffort},#{outfitNote},#{hairNote},#{restrictionNote},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    int create(PreferenceRow row);

    @Update(
            "UPDATE user_preference SET interests=#{interests},styles=#{styles},preferred_colors=#{preferredColors},avoided_colors=#{avoidedColors},fits=#{fits},hair_lengths=#{hairLengths},restrictions=#{restrictions},dye_acceptance=#{dyeAcceptance},perm_acceptance=#{permAcceptance},grooming_effort=#{groomingEffort},outfit_note=#{outfitNote},hair_note=#{hairNote},restriction_note=#{restrictionNote},updated_at=UTC_TIMESTAMP(3) WHERE user_id=#{userId}")
    int update(PreferenceRow row);
}
