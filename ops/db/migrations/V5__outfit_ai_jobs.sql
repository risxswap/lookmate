-- 常用搭配 AI 任务复用 design_task 生命周期；无外键，保留独立历史快照。
CREATE TABLE outfit_ai_job (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    task_id BIGINT NOT NULL,
    outfit_id BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_outfit_ai_task (task_id),
    KEY idx_outfit_ai_history (user_id, outfit_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
