CREATE TABLE `outfit_inspiration_favorite` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `inspiration_id` VARCHAR(64) NOT NULL COMMENT '跨版本稳定款式标识',
    `display_snapshot` JSON NOT NULL COMMENT '收藏时展示信息，仅下架回显使用',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_outfit_inspiration_favorite_user_style` (`user_id`, `inspiration_id`),
    KEY `idx_outfit_inspiration_favorite_created` (`user_id`, `created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='用户穿搭灵感收藏';
