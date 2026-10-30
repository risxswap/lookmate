ALTER TABLE `user`
    MODIFY username VARCHAR(32) NULL,
    MODIFY password_hash VARCHAR(255) NULL,
    ADD COLUMN wechat_app_id VARCHAR(64) NULL,
    ADD COLUMN wechat_open_id VARCHAR(128) NULL,
    ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN avatar_file_id BIGINT NULL,
    ADD UNIQUE KEY uk_user_wechat (wechat_app_id, wechat_open_id),
    ADD KEY idx_user_avatar (avatar_file_id);

CREATE TABLE auth_ticket (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ticket_key VARCHAR(32) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    owner_hash VARCHAR(64) NULL,
    payload TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_auth_ticket_key (ticket_key),
    KEY idx_auth_ticket_owner (owner_hash, kind, status),
    KEY idx_auth_ticket_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
