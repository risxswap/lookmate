-- Generated task failures are separate from immutable input snapshots.
ALTER TABLE `design_task` ADD COLUMN `outcome_snapshot` JSON NULL COMMENT '版本化失败与结果待确认说明，不含供应商原始响应';
