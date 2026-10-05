-- Preserve automatic decisions; final teacher-reviewed scores can be partial.
ALTER TABLE grading_result
    MODIFY COLUMN status ENUM('correct','incorrect','flagged','partial') NOT NULL;
ALTER TABLE manual_review
    MODIFY COLUMN override_action ENUM('accepted_correct','marked_incorrect',
        'manual_answer_override','manual_score_override') NULL;
