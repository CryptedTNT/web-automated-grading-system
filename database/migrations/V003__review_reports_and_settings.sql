-- =====================================================================
-- V003 -- Manual review, reports, and preferences
--
-- WAIM Weeks 5-6 (August 24 - September 06, 2026)
--   Planned: "Complete system development and internal debugging"
--            / "Functional end-to-end system prototype"
--
-- Layer 4 of the approved ERD, plus the two tables that close the loop
-- from a graded sheet to something a teacher can act on and hand in:
-- the human-review record, the Excel export record, and per-user
-- preferences.
--
-- With this applied, every screen in the front end has a table behind
-- it. Views live in R__views.sql.
--
-- Depends on V001 (faculty, answer_key) and V002 (grading_result,
-- grading_session).
-- =====================================================================

-- ---------------------------------------------------------------------
-- manual_review -- only the items a human actually checked.
--
-- Not every grading_result has one; only low-confidence / low-match
-- items reach the Review Flagged page.
--
-- override_action records WHICH of the three decisions the teacher made,
-- taken verbatim from the front end's review screen:
--   accepted_correct       -- "Accept as correct" (full points)
--   marked_incorrect       -- "Mark as incorrect" (zero points)
--   manual_answer_override -- corrected the text, then accepted it
--
-- This column is what lets Week 8 report not just "how often was the
-- system wrong" but "in which direction" -- false flags versus missed
-- errors. Those are different failure modes and a panel will ask.
-- ---------------------------------------------------------------------
CREATE TABLE manual_review (
    review_id           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    result_id           INT UNSIGNED    NOT NULL,
    reviewed_by         INT UNSIGNED    NULL,
    override_action     ENUM('accepted_correct','marked_incorrect',
                             'manual_answer_override') NULL,
    original_answer     TEXT            NULL,   -- text before correction
    corrected_answer    TEXT            NULL,
    final_score         DECIMAL(6,2)    NULL,
    review_status       ENUM('pending','reviewed','corrected') NOT NULL DEFAULT 'pending',
    review_seconds      INT UNSIGNED    NULL,   -- time spent on this item
    reviewed_at         DATETIME        NULL,
    PRIMARY KEY (review_id),
    UNIQUE KEY uq_review_result (result_id),   -- at most one review per result
    KEY idx_review_status (review_status),
    KEY idx_review_faculty (reviewed_by),
    KEY idx_review_action (override_action),
    CONSTRAINT fk_review_result
        FOREIGN KEY (result_id) REFERENCES grading_result (result_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_review_faculty
        FOREIGN KEY (reviewed_by) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE on review_seconds: added for the sixth objective, the
-- effectiveness comparison against manual grading. Time spent reviewing
-- flagged items is the honest cost of the automated path -- a system
-- that flags everything is fast at grading and slow overall. Record it
-- if the review UI can; leave NULL if not. Better to have the column
-- unused than to reach Week 8 and find the data was never captured.

-- ---------------------------------------------------------------------
-- report -- the generated structured Excel export record.
-- ---------------------------------------------------------------------
CREATE TABLE report (
    report_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    answer_key_id   INT UNSIGNED    NOT NULL,
    session_id      INT UNSIGNED    NULL,
    generated_by    INT UNSIGNED    NOT NULL,   -- FK to faculty
    file_name       VARCHAR(255)    NULL,
    file_path       VARCHAR(255)    NOT NULL,
    generated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (report_id),
    KEY idx_report_answerkey (answer_key_id),
    KEY idx_report_session (session_id),
    KEY idx_report_faculty (generated_by),
    CONSTRAINT fk_report_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_report_session
        FOREIGN KEY (session_id) REFERENCES grading_session (session_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_report_faculty
        FOREIGN KEY (generated_by) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- app_setting -- per-faculty preferences.
--
-- Replaces the front end's single `ags_settings` object. Key/value
-- rather than one column per preference, because the Settings page
-- gains options over time and a new preference should not need a
-- schema migration.
--
-- Keys currently used by the app:
--   theme               -- palette name
--   remember_me         -- 'true' | 'false'
--   export_preferences  -- JSON: folder_label, filename_format, and the
--                          include_* column toggles
--
-- setting_value is JSON so structured preferences stay queryable.
-- Scalars are stored as JSON strings, e.g. '"true"'.
-- ---------------------------------------------------------------------
CREATE TABLE app_setting (
    faculty_id      INT UNSIGNED    NOT NULL,
    setting_key     VARCHAR(60)     NOT NULL,
    setting_value   JSON            NULL,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (faculty_id, setting_key),
    CONSTRAINT fk_setting_faculty
        FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
