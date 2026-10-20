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
            Integer version = jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history "
                    + "WHERE version = '1' AND success = 1", Integer.class);
            if (version == null || version != 1) {
                throw new IllegalStateException("数据库未完成 V1 迁移，请通过 ops 显式执行 Flyway");
            }
            // 仅读取本模块必需列，不修改表或迁移记录。
            jdbc.queryForList("SELECT id, username, password_hash, status, display_name, created_at, updated_at "
                    + "FROM `user` WHERE 1 = 0");
        };
    }
}
