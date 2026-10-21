-- 个人属性及偏好；保留历史用户 NULL，不修改尺寸历史。
ALTER TABLE `user`
    ADD COLUMN `gender` VARCHAR(16) NULL DEFAULT NULL COMMENT 'FEMALE / MALE',
    ADD COLUMN `birth_date` DATE NULL DEFAULT NULL COMMENT '出生日期';

CREATE TABLE `user_preference` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `interests` JSON NULL,
    `styles` JSON NULL,
    `preferred_colors` JSON NULL,
    `avoided_colors` JSON NULL,
    `fits` JSON NULL,
    `hair_lengths` JSON NULL,
    `restrictions` JSON NULL,
    `dye_acceptance` VARCHAR(16) NULL,
    `perm_acceptance` VARCHAR(16) NULL,
    `grooming_effort` VARCHAR(16) NULL,
    `outfit_note` VARCHAR(500) NULL,
    `hair_note` VARCHAR(500) NULL,
    `restriction_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_preference_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='用户兴趣与偏好';
