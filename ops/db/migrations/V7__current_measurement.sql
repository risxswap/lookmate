-- Preserve existing history and copy the selected record into an editable current row.
-- Stop old application writers before running this explicit migration.
ALTER TABLE body_measurement
    ADD COLUMN record_kind VARCHAR(16) NOT NULL DEFAULT 'HISTORY' COMMENT 'HISTORY 快照或 CURRENT 当前尺寸',
    ADD COLUMN current_user_id BIGINT GENERATED ALWAYS AS (CASE WHEN record_kind = 'CURRENT' THEN user_id ELSE NULL END) STORED,
    ADD CONSTRAINT chk_measurement_kind CHECK (record_kind IN ('CURRENT','HISTORY')),
    ADD UNIQUE KEY uk_measurement_current_user (current_user_id),
    ADD KEY idx_measurement_history (user_id, record_kind, created_at, id);

INSERT INTO body_measurement (user_id,record_kind,height,weight,neck,chest,underbust,waist,abdomen,hip,shoulder,back_width,arm_length,upper_arm,forearm,wrist,front_waist_length,back_waist_length,inseam,outseam,thigh,knee,calf,ankle,head,left_foot_length,right_foot_length,left_foot_width,right_foot_width,created_at,updated_at)
SELECT m.user_id,'CURRENT',m.height,m.weight,m.neck,m.chest,m.underbust,m.waist,m.abdomen,m.hip,m.shoulder,m.back_width,m.arm_length,m.upper_arm,m.forearm,m.wrist,m.front_waist_length,m.back_waist_length,m.inseam,m.outseam,m.thigh,m.knee,m.calf,m.ankle,m.head,m.left_foot_length,m.right_foot_length,m.left_foot_width,m.right_foot_width,m.created_at,m.updated_at
FROM body_measurement m JOIN `user` u ON u.id=m.user_id AND u.current_measurement_id=m.id;

UPDATE `user` u JOIN body_measurement m ON m.user_id=u.id AND m.record_kind='CURRENT'
SET u.current_measurement_id=m.id;

ALTER TABLE body_measurement COMMENT='身体尺寸当前值与历史快照';
