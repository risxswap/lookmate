-- Lookmate 初始结构；仅创建表和固定分类，不创建数据库或账号。
-- 目标：MySQL 8.0+；部署版本尚待锁定。
-- 由 ops 的 Flyway 显式执行；不使用 IF NOT EXISTS 掩盖结构差异。
-- 不建外键或 CHECK，关联存在性、归属、状态和数值等业务校验由代码处理。
-- created_at / updated_at 由应用显式写入 UTC，不使用自动更新时间。
-- 表名和列名统一引用；utf8mb4_bin 保持名称及对象键大小写区别。
SET NAMES utf8mb4;


CREATE TABLE `user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `username` VARCHAR(32) NOT NULL COMMENT '小写登录名，由应用校验格式',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希，含算法参数',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' COMMENT '账号状态',
    `display_name` VARCHAR(64) NULL COMMENT '显示名称',
    `current_measurement_id` BIGINT NULL COMMENT '当前尺寸记录 ID',
    `default_portrait_id` BIGINT NULL COMMENT '默认头像照片记录 ID',
    `default_full_body_id` BIGINT NULL COMMENT '默认全身照片记录 ID',
    `active_task_id` BIGINT NULL COMMENT '当前占用任务名额的任务 ID',
    `version` BIGINT NOT NULL DEFAULT 0 COMMENT '用户编辑版本，不随后台控制字段变化递增',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='用户及个人资料';


CREATE TABLE `body_measurement` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `height` DECIMAL(6,2) NULL COMMENT '身高，厘米',
    `weight` DECIMAL(6,2) NULL COMMENT '体重，千克',
    `neck` DECIMAL(6,2) NULL COMMENT '颈围，厘米',
    `chest` DECIMAL(6,2) NULL COMMENT '胸围，厘米',
    `underbust` DECIMAL(6,2) NULL COMMENT '下胸围，厘米',
    `waist` DECIMAL(6,2) NULL COMMENT '腰围，厘米',
    `abdomen` DECIMAL(6,2) NULL COMMENT '腹围，厘米',
    `hip` DECIMAL(6,2) NULL COMMENT '臀围，厘米',
    `shoulder` DECIMAL(6,2) NULL COMMENT '肩宽，厘米',
    `back_width` DECIMAL(6,2) NULL COMMENT '背宽，厘米',
    `arm_length` DECIMAL(6,2) NULL COMMENT '臂长，厘米',
    `upper_arm` DECIMAL(6,2) NULL COMMENT '上臂围，厘米',
    `forearm` DECIMAL(6,2) NULL COMMENT '前臂围，厘米',
    `wrist` DECIMAL(6,2) NULL COMMENT '腕围，厘米',
    `front_waist_length` DECIMAL(6,2) NULL COMMENT '前腰节长，厘米',
    `back_waist_length` DECIMAL(6,2) NULL COMMENT '后腰节长，厘米',
    `inseam` DECIMAL(6,2) NULL COMMENT '内侧腿长，厘米',
    `outseam` DECIMAL(6,2) NULL COMMENT '外侧腿长，厘米',
    `thigh` DECIMAL(6,2) NULL COMMENT '大腿围，厘米',
    `knee` DECIMAL(6,2) NULL COMMENT '膝围，厘米',
    `calf` DECIMAL(6,2) NULL COMMENT '小腿围，厘米',
    `ankle` DECIMAL(6,2) NULL COMMENT '踝围，厘米',
    `head` DECIMAL(6,2) NULL COMMENT '头围，厘米',
    `left_foot_length` DECIMAL(6,2) NULL COMMENT '左脚长，厘米',
    `right_foot_length` DECIMAL(6,2) NULL COMMENT '右脚长，厘米',
    `left_foot_width` DECIMAL(6,2) NULL COMMENT '左脚宽，厘米',
    `right_foot_width` DECIMAL(6,2) NULL COMMENT '右脚宽，厘米',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    KEY `idx_measurement_user_created` (`user_id`, `created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='完整身体尺寸历史';


CREATE TABLE `file_asset` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `bucket` VARCHAR(128) NOT NULL COMMENT '七牛空间',
    `storage_key` VARCHAR(255) NOT NULL COMMENT '处理图预留目标键，不代表对象已存在',
    `original_key` VARCHAR(255) NULL COMMENT '直传原图键',
    `thumbnail_key` VARCHAR(255) NULL COMMENT '缩略图键',
    `original_name` VARCHAR(255) NULL COMMENT '原始文件名，仅用于展示',
    `mime_type` VARCHAR(64) NULL COMMENT '核验后的内容类型',
    `size_bytes` BIGINT NULL COMMENT '处理图字节数',
    `width` INT NULL COMMENT '处理图宽度',
    `height` INT NULL COMMENT '处理图高度',
    `status` VARCHAR(16) NOT NULL DEFAULT 'UPLOADING' COMMENT '文件生命周期状态',
    `expires_at` DATETIME(3) NULL COMMENT '临时上传从申请起 24 小时过期',
    `cleanup_after` DATETIME(3) NULL COMMENT '计划清理时间',
    `verification_token` VARCHAR(64) NULL COMMENT '核验执行权',
    `verification_lease_until` DATETIME(3) NULL COMMENT '核验租约期限',
    `validation_error` VARCHAR(1000) NULL COMMENT '安全核验错误摘要',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_file_object` (`bucket`, `storage_key`),
    KEY `idx_file_user_created` (`user_id`, `created_at`, `id`),
    KEY `idx_file_expiry` (`status`, `expires_at`),
    KEY `idx_file_cleanup` (`status`, `cleanup_after`),
    KEY `idx_file_verify_lease` (`status`, `verification_lease_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='图片文件资产';


CREATE TABLE `user_photo` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `asset_id` BIGINT NOT NULL COMMENT '文件资产 ID',
    `photo_type` VARCHAR(16) NOT NULL COMMENT '照片用途',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    KEY `idx_photo_user_created` (`user_id`, `created_at`, `id`),
    KEY `idx_photo_type` (`user_id`, `photo_type`, `created_at`, `id`),
    KEY `idx_photo_asset` (`asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='个人照片库';


CREATE TABLE `dress_category` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `code` VARCHAR(32) NOT NULL COMMENT '固定分类编码',
    `name` VARCHAR(32) NOT NULL COMMENT '分类名称',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_dress_category_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='穿戴分类';


CREATE TABLE `dress` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID',
    `name` VARCHAR(100) NOT NULL COMMENT '用户拥有的单品名称',
    `category_id` BIGINT NOT NULL COMMENT '固定分类 ID',
    `color` VARCHAR(100) NULL COMMENT '用户填写的单品主色',
    `season_mask` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '春夏秋冬为 1、2、4、8，0 表示不限',
    `notes` VARCHAR(1000) NULL COMMENT '用户备注',
    `image_revision` BIGINT NOT NULL DEFAULT 1 COMMENT '图片集合版本，新增删除替换或排序变化后递增',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    KEY `idx_dress_user_created` (`user_id`, `created_at`, `id`),
    KEY `idx_dress_category` (`user_id`, `category_id`, `created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='用户衣橱实物单品';


CREATE TABLE `dress_image` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID',
    `dress_id` BIGINT NOT NULL COMMENT '衣橱单品 ID',
    `asset_id` BIGINT NOT NULL COMMENT '图片文件资产 ID，创建后不改；换图新建记录',
    `sort_order` INT NOT NULL COMMENT '图片顺序，从 0 开始，第一张为封面',
    `view_type` VARCHAR(16) NULL COMMENT 'AI 视角建议：FRONT/BACK/SIDE/DETAIL/OTHER',
    `description` TEXT NULL COMMENT 'AI 图片内容描述',
    `colors` JSON NULL COMMENT 'AI 识别的可见颜色数组',
    `pattern` VARCHAR(255) NULL COMMENT 'AI 可见图案描述',
    `style_tags` JSON NULL COMMENT 'AI 风格标签数组',
    `fit` VARCHAR(100) NULL COMMENT 'AI 可判断的版型',
    `material_description` VARCHAR(1000) NULL COMMENT 'AI 材质外观描述，不代表实际面料成分',
    `details` JSON NULL COMMENT 'AI 领口袖型口袋纽扣等细节对象',
    `recognition_id` BIGINT NULL COMMENT '上述 AI 特征的识别任务 ID',
    `manual_features` JSON NULL COMMENT '人工逐字段覆盖，显式 null 为用户清空',
    `version` BIGINT NOT NULL DEFAULT 0 COMMENT '图片人工编辑版本，AI 回写不递增',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_dress_image_asset` (`dress_id`, `asset_id`),
    KEY `idx_dress_image_order` (`user_id`, `dress_id`, `sort_order`, `id`),
    KEY `idx_dress_image_asset` (`asset_id`),
    KEY `idx_dress_image_recognition` (`recognition_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='单品图片及图片级识别特征';


CREATE TABLE `dress_recognition` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID',
    `dress_id` BIGINT NOT NULL COMMENT '被识别的单品 ID',
    `image_revision` BIGINT NOT NULL COMMENT '识别时固定的图片集合版本',
    `attempt_no` INT NOT NULL COMMENT '同一单品同一图片集合的识别次数，从 1 开始',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN/SUPERSEDED',
    `input_snapshot` JSON NOT NULL COMMENT '固定图片 ID、资产 ID、顺序及基础资料快照，含格式版本',
    `holds_input_assets` TINYINT NOT NULL DEFAULT 1 COMMENT '是否仍保留输入快照中资产的有效引用，0/1 由代码校验',
    `config_snapshot` JSON NOT NULL COMMENT '识别模型和提示词配置版本，不含密钥',
    `result_snapshot` JSON NULL COMMENT '按图片 ID 返回的结构化结果，保留历史不随人工修改',
    `current_call_id` BIGINT NULL COMMENT '当前阶段模型调用 ID，事务内绑定执行权并校验归属',
    `attempt_token` VARCHAR(64) NULL COMMENT '识别执行权，拒绝失效工作写回',
    `lease_until` DATETIME(3) NULL COMMENT '执行租约，超时先核实调用而非直接重发',
    `next_check_at` DATETIME(3) NULL COMMENT '未知调用下次核实时间',
    `started_at` DATETIME(3) NULL COMMENT '开始时间，UTC',
    `finished_at` DATETIME(3) NULL COMMENT '结束时间，UTC',
    `error_code` VARCHAR(64) NULL COMMENT '安全错误码',
    `error_message` VARCHAR(1000) NULL COMMENT '安全错误摘要',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_dress_recognition_attempt` (`dress_id`, `image_revision`, `attempt_no`),
    KEY `idx_dress_recognition_owner` (`user_id`, `dress_id`, `created_at`, `id`),
    KEY `idx_dress_recognition_claim` (`status`, `created_at`, `id`),
    KEY `idx_dress_recognition_lease` (`status`, `lease_until`),
    KEY `idx_dress_recognition_check` (`status`, `next_check_at`),
    KEY `idx_dress_recognition_asset_hold` (`user_id`, `holds_input_assets`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='一次整组图片识别任务及历史结果';


CREATE TABLE `design_task` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `design_type` VARCHAR(16) NOT NULL COMMENT '发型或穿搭',
    `status` VARCHAR(24) NOT NULL DEFAULT 'QUEUED' COMMENT '任务状态',
    `client_request_id` VARCHAR(64) NOT NULL COMMENT '一次提交的幂等键',
    `request_hash` CHAR(64) NOT NULL COMMENT '规范化客户端请求 SHA-256',
    `input_snapshot` JSON NOT NULL COMMENT '输入资料及格式版本快照',
    `model_config_snapshot` JSON NOT NULL COMMENT '模型配置版本和参数，不含密钥',
    `retry_of_task_id` BIGINT NULL COMMENT '仍存在的来源任务 ID',
    `retry_source_id` BIGINT NULL COMMENT '来源编号快照，删除来源后保留',
    `resume_stage` VARCHAR(16) NOT NULL DEFAULT 'PLAN' COMMENT '从规划或图片阶段开始',
    `result_url_ciphertext` MEDIUMTEXT NULL COMMENT '生图结果临时下载地址密文，保存完成后清空，不返回前端',
    `current_call_id` BIGINT NULL COMMENT '当前阶段模型调用 ID，事务内绑定执行权并校验归属',
    `attempt_token` VARCHAR(64) NULL COMMENT '当前执行权',
    `lease_until` DATETIME(3) NULL COMMENT '执行租约',
    `next_check_at` DATETIME(3) NULL COMMENT '下一次核实或保存时间',
    `started_at` DATETIME(3) NULL COMMENT '开始时间',
    `finished_at` DATETIME(3) NULL COMMENT '阶段终结时间，未知恢复后可更新',
    `hidden_at` DATETIME(3) NULL COMMENT '用户隐藏时间',
    `purge_after` DATETIME(3) NULL COMMENT '隐藏后的清理期限',
    `error_code` VARCHAR(64) NULL COMMENT '稳定错误码',
    `error_message` VARCHAR(1000) NULL COMMENT '安全用户提示',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_task_request` (`user_id`, `client_request_id`),
    KEY `idx_task_user_created` (`user_id`, `created_at`, `id`),
    KEY `idx_task_claim` (`status`, `created_at`, `id`),
    KEY `idx_task_lease` (`status`, `lease_until`),
    KEY `idx_task_check` (`status`, `next_check_at`),
    KEY `idx_task_purge` (`purge_after`),
    KEY `idx_task_retry` (`retry_of_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='异步设计任务';


CREATE TABLE `model_call` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键，一次实际调用的编号',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID',
    `owner_type` VARCHAR(24) NOT NULL COMMENT 'DESIGN_TASK 或 DRESS_RECOGNITION',
    `owner_id` BIGINT NOT NULL COMMENT '所属设计任务或整组识别任务 ID',
    `stage` VARCHAR(16) NOT NULL COMMENT 'RECOGNIZE / PLAN / IMAGE',
    `provider` VARCHAR(128) NOT NULL COMMENT '实际模型提供商',
    `model` VARCHAR(128) NOT NULL COMMENT '实际模型标识',
    `request_id` VARCHAR(255) NULL COMMENT '供应商请求编号，供核实结果',
    `status` VARCHAR(24) NOT NULL DEFAULT 'PREPARED' COMMENT 'PREPARED/SENT/SUCCEEDED/FAILED/UNKNOWN',
    `started_at` DATETIME(3) NULL COMMENT '调用开始时间，UTC',
    `finished_at` DATETIME(3) NULL COMMENT '调用结束时间，UTC',
    `error_code` VARCHAR(64) NULL COMMENT '安全错误码',
    `error_message` VARCHAR(1000) NULL COMMENT '安全错误摘要',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    KEY `idx_model_call_stage` (`owner_type`, `owner_id`, `stage`, `id`),
    KEY `idx_model_call_owner_user` (`user_id`, `owner_type`, `owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='模型调用记录';


CREATE TABLE `design_task_asset` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `task_id` BIGINT NOT NULL COMMENT '设计任务 ID',
    `asset_id` BIGINT NOT NULL COMMENT '文件资产 ID',
    `role` VARCHAR(16) NOT NULL COMMENT 'PERSON / CANDIDATE / DRESS / REFERENCE / OUTPUT',
    `source_dress_id` BIGINT NULL COMMENT '衣橱来源编号快照，源单品删除后保留',
    `source_dress_image_id` BIGINT NULL COMMENT '来源单品图片编号快照，图片删除后保留',
    `position` INT NOT NULL COMMENT '用途内位置，从 0 开始',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_task_asset_position` (`task_id`, `role`, `position`),
    KEY `idx_task_asset_file` (`asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='任务文件引用';


CREATE TABLE `design_result` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `task_id` BIGINT NOT NULL COMMENT '设计任务 ID',
    `title` VARCHAR(100) NOT NULL COMMENT '方案名称',
    `summary` TEXT NOT NULL COMMENT '方案概述',
    `style` VARCHAR(255) NOT NULL COMMENT '整体风格描述',
    `occasion` VARCHAR(255) NOT NULL COMMENT '适用场景',
    `design_reason` TEXT NOT NULL COMMENT '结合用户要求的设计理由',
    `color_advice` TEXT NULL COMMENT '穿搭配色说明，发型方案可空',
    `wearing_advice` TEXT NULL COMMENT '整套穿搭的穿着建议，发型方案可空',
    `image_prompt` MEDIUMTEXT NOT NULL COMMENT '生图提示词',
    `plan_provenance` JSON NOT NULL COMMENT '原始规划来源，不含密钥',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_result_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='设计方案与说明';


-- 方案类型及明细完整性由应用在同一事务中校验和保存。
CREATE TABLE `design_result_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `result_id` BIGINT NOT NULL COMMENT '所属穿搭方案 ID',
    `dress_id` BIGINT NOT NULL COMMENT '衣橱单品编号快照，源记录删除后保留',
    `dress_name` VARCHAR(100) NOT NULL COMMENT '生成时的单品名称快照',
    `category_name` VARCHAR(32) NOT NULL COMMENT '生成时的分类名称快照',
    `match_reason` TEXT NOT NULL COMMENT '选择该单品的理由',
    `wearing_method` TEXT NOT NULL COMMENT '该单品的穿着和搭配方式',
    `sort_order` INT NOT NULL COMMENT '展示顺序，从 0 开始',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_result_item_dress` (`result_id`, `dress_id`),
    KEY `idx_result_item_order` (`result_id`, `sort_order`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='穿搭方案单品及固定说明';


CREATE TABLE `design_result_hairstyle` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `result_id` BIGINT NOT NULL COMMENT '所属发型方案 ID',
    `hairstyle_name` VARCHAR(100) NOT NULL COMMENT '发型名称',
    `length_advice` TEXT NOT NULL COMMENT '长度建议',
    `bangs_advice` TEXT NOT NULL COMMENT '刘海建议，可明确不留刘海',
    `parting_advice` TEXT NOT NULL COMMENT '分缝建议',
    `texture_advice` TEXT NOT NULL COMMENT '卷直建议',
    `hair_color_advice` TEXT NOT NULL COMMENT '发色建议，可保留原发色',
    `care_advice` TEXT NOT NULL COMMENT '日常打理说明',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_result_hairstyle` (`result_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='发型方案固定栏目';


CREATE TABLE `design_favorite` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `result_id` BIGINT NOT NULL COMMENT '完整成功方案 ID',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_favorite_result` (`user_id`, `result_id`),
    KEY `idx_favorite_user_created` (`user_id`, `created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='设计收藏';


CREATE TABLE `favorite_folder` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `name` VARCHAR(64) NOT NULL COMMENT '去首尾空白、NFC 规范化后名称，区分大小写',
    `version` BIGINT NOT NULL DEFAULT 0 COMMENT '用户编辑版本，不随后台控制字段变化递增',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_folder_name` (`user_id`, `name`),
    KEY `idx_folder_user_created` (`user_id`, `created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='收藏夹';


CREATE TABLE `favorite_folder_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT NOT NULL COMMENT '所属用户 ID，代码维护关联',
    `favorite_folder_id` BIGINT NOT NULL COMMENT '收藏夹 ID',
    `design_favorite_id` BIGINT NOT NULL COMMENT '设计收藏 ID',
    `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
    `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_folder_item` (`favorite_folder_id`, `design_favorite_id`),
    KEY `idx_folder_item_favorite` (`design_favorite_id`),
    KEY `idx_folder_item_list` (`user_id`, `favorite_folder_id`, `created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='收藏夹归属';


-- 固定分类。帽子等饰品归 ACCESSORY；不额外增加未经确认的分类。
INSERT INTO `dress_category` (`code`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
    ('TOP', '上装', 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('BOTTOM', '下装', 20, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('DRESS', '连衣裙', 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('COAT', '外套', 40, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('SHOE', '鞋', 50, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('BAG', '包', 60, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('ACCESSORY', '配饰', 70, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
