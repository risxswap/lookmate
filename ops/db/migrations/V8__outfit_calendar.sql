-- 穿搭计划保存独立快照与资产引用；无外键，由 ops 显式执行。
CREATE TABLE outfit_plan (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT NOT NULL,
 plan_date DATE NOT NULL,
 scene VARCHAR(20) NOT NULL,
 note VARCHAR(80) NULL,
 version BIGINT NOT NULL DEFAULT 0,
 source_outfit_id BIGINT NULL,
 snapshot JSON NULL,
 client_request_id CHAR(36) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY uk_outfit_plan_request(user_id,client_request_id),
 KEY idx_outfit_plan_day(user_id,plan_date,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE outfit_plan_asset (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT NOT NULL,
 plan_id BIGINT NOT NULL,
 asset_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY uk_outfit_plan_asset(plan_id,asset_id),
 KEY idx_outfit_plan_asset_user(user_id,plan_id),
 KEY idx_outfit_plan_asset_asset(asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE outfit_scene (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT NOT NULL,
 outfit_id BIGINT NOT NULL,
 name VARCHAR(20) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY uk_outfit_scene(outfit_id,name),
 KEY idx_outfit_scene_user(user_id,name,outfit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE outfit_scene_option (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT NOT NULL,
 name VARCHAR(20) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY uk_outfit_scene_option(user_id,name),
 KEY idx_outfit_scene_option_order(user_id,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
