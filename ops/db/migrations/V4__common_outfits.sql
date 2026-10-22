-- 常用搭配独立快照与资产引用；由 ops 显式执行，无外键。
CREATE TABLE outfit (
 id BIGINT NOT NULL AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 name VARCHAR(100) NOT NULL, note VARCHAR(2000) NULL, pinned BOOLEAN NOT NULL DEFAULT FALSE, version BIGINT NOT NULL DEFAULT 0, revision BIGINT NOT NULL DEFAULT 0, source_design_id BIGINT NULL, KEY idx_outfit_user_pinned (user_id,pinned,created_at,id),
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE outfit_item (
 id BIGINT NOT NULL AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 outfit_id BIGINT NOT NULL, dress_id BIGINT NOT NULL, position INT NOT NULL, snapshot JSON NOT NULL, UNIQUE KEY uk_outfit_dress(outfit_id,dress_id), KEY idx_outfit_item_user(user_id,outfit_id),
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE outfit_item_asset (
 id BIGINT NOT NULL AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 outfit_id BIGINT NOT NULL, asset_id BIGINT NOT NULL, UNIQUE KEY uk_outfit_asset(outfit_id,asset_id), KEY idx_outfit_asset_asset(asset_id),
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE outfit_group (
 id BIGINT NOT NULL AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 name VARCHAR(50) NOT NULL, version BIGINT NOT NULL DEFAULT 0, UNIQUE KEY uk_outfit_group_name(user_id,name), KEY idx_outfit_group_user(user_id,created_at,id),
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE outfit_group_member (
 id BIGINT NOT NULL AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 outfit_id BIGINT NOT NULL, group_id BIGINT NOT NULL, UNIQUE KEY uk_outfit_group_member(outfit_id,group_id), KEY idx_outfit_member_group(user_id,group_id,outfit_id),
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
