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
                                    + "WHERE version IN ('1','2','3') AND success = 1",
                            Integer.class);
            if (version == null || version != 3) {
                throw new IllegalStateException("数据库未完成 V3 迁移，请通过 ops 显式执行 Flyway");
            }
            jdbc.queryForList("SELECT outcome_snapshot FROM design_task WHERE 1=0");
            // 仅读取本模块必需列，不修改表或迁移记录。
            jdbc.queryForList(
                    "SELECT id, username, password_hash, status, display_name, gender, birth_date, created_at, updated_at "
                            + "FROM `user` WHERE 1 = 0");
            jdbc.queryForList(
                    "SELECT id,user_id,interests,styles,preferred_colors,avoided_colors,fits,hair_lengths,restrictions,dye_acceptance,perm_acceptance,grooming_effort,outfit_note,hair_note,restriction_note,created_at,updated_at FROM user_preference WHERE 1=0");
        };
    }
}
