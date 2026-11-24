ALTER TABLE outfit
    ADD INDEX idx_outfit_source_output_file (source_output_file_id),
    ALGORITHM=INPLACE, LOCK=NONE;
