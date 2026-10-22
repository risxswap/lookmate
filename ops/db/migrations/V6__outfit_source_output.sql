-- 从已有完整设计保存搭配时，保留效果图独立引用。
ALTER TABLE outfit ADD COLUMN source_output_file_id BIGINT NULL AFTER source_design_id;
