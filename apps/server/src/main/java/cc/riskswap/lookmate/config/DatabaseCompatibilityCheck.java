package cc.riskswap.lookmate.config;

import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration(proxyBeanMethods = false)
public class DatabaseCompatibilityCheck {
    @Bean
    ApplicationRunner checkDatabaseCompatibility(JdbcTemplate jdbc) {
        return arguments -> {
            Integer version =
                    jdbc.queryForObject(
                            "SELECT COUNT(*) FROM flyway_schema_history "
                                    + "WHERE version IN ('1','2','3','4','5','6','7','8','9','10') AND success = 1",
                            Integer.class);
            if (version == null || version != 10) {
                throw new IllegalStateException("数据库未完成 V10 迁移，请通过 ops 显式执行 Flyway");
            }
            jdbc.queryForList(
                    "SELECT id,user_id,inspiration_id,display_snapshot,created_at,updated_at FROM outfit_inspiration_favorite WHERE 1=0");
            jdbc.queryForList(
                    "SELECT id,user_id,hairstyle_id,display_snapshot,created_at,updated_at FROM hairstyle_favorite WHERE 1=0");
            jdbc.queryForList(
                    "SELECT id,plan_date,snapshot,client_request_id,request_hash FROM outfit_plan WHERE 1=0");
            jdbc.queryForList("SELECT plan_id,asset_id FROM outfit_plan_asset WHERE 1=0");
            jdbc.queryForList("SELECT outfit_id,name FROM outfit_scene WHERE 1=0");
            jdbc.queryForList("SELECT user_id,name FROM outfit_scene_option WHERE 1=0");
            jdbc.queryForList("SELECT record_kind,current_user_id FROM body_measurement WHERE 1=0");
            jdbc.queryForList("SELECT outcome_snapshot FROM design_task WHERE 1=0");
            jdbc.queryForList("SELECT id,revision,source_output_file_id FROM outfit WHERE 1=0");
            jdbc.queryForList(
                    "SELECT task_id,outfit_id,revision,kind FROM outfit_ai_job WHERE 1=0");
            // 仅读取本模块必需列，不修改表或迁移记录。
            jdbc.queryForList(
                    "SELECT id, username, password_hash, status, display_name, gender, birth_date, created_at, updated_at "
                            + "FROM `user` WHERE 1 = 0");
            jdbc.queryForList(
                    "SELECT id,user_id,interests,styles,preferred_colors,avoided_colors,fits,hair_lengths,restrictions,dye_acceptance,perm_acceptance,grooming_effort,outfit_note,hair_note,restriction_note,created_at,updated_at FROM user_preference WHERE 1=0");
        };
    }
}
