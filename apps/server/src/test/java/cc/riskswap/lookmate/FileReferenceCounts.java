package cc.riskswap.lookmate;

import org.springframework.jdbc.core.JdbcTemplate;

final class FileReferenceCounts {
    private FileReferenceCounts() {}

    static long forAsset(JdbcTemplate jdbc, long id) {
        return jdbc.queryForObject(
                """
                SELECT (SELECT COUNT(*) FROM user_photo WHERE asset_id=?)
                     + (SELECT COUNT(*) FROM dress_image WHERE asset_id=?)
                     + (SELECT COUNT(*) FROM design_task_asset WHERE asset_id=?)
                     + (SELECT COUNT(*) FROM outfit_item_asset WHERE asset_id=?)
                     + (SELECT COUNT(*) FROM outfit_plan_asset WHERE asset_id=?)
                     + (SELECT COUNT(*) FROM `user` WHERE avatar_file_id=?)
                     + (SELECT COUNT(*) FROM outfit WHERE source_output_file_id=?)
                """,
                Long.class,
                id,
                id,
                id,
                id,
                id,
                id,
                id);
    }
}
