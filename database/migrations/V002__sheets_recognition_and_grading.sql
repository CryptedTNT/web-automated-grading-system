-- =====================================================================
-- V002 -- Sheets, recognition output, and grading results
--
-- WAIM Week 4 (August 17-23, 2026)
--   Planned: "Continue system development (segmentation, recognition,
--             grading modules)" / "Working system components under
--             development"
--
-- Layers 2 and 3 of the approved ERD: everything the three pipeline
-- modules write into.
--   segmentation -> exam_sheet, student_info, student_answer.crop_path
--   recognition  -> student_answer.recognized_text / htr_confidence
--   grading      -> grading_result
--
-- Depends on V001 (answer_key_item).
-- =====================================================================

-- ---------------------------------------------------------------------
-- grading_session -- ONE PROCESSING RUN.
--
-- Not in the draft ERD, but the app cannot work without it: the Upload,
-- Processing, Results, and Reports pages are all organised around a
-- "session", which is one batch of answer sheets processed against one
-- answer key in one run.
--
-- status mirrors the four states in the front end's processing store:
--   processing -- a run is live right now
--   completed  -- every queued image produced a record
--   cancelled  -- stopped by the user; records already written are kept
--   failed     -- the model adapter threw, or the run was interrupted
-- ---------------------------------------------------------------------
CREATE TABLE grading_session (
    session_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    faculty_id       INT UNSIGNED   NOT NULL,
    answer_key_id    INT UNSIGNED   NOT NULL,
    session_name     VARCHAR(150)   NOT NULL,
    source_folder    VARCHAR(255)   NULL,   -- the app's `folder` label
    status           ENUM('processing','completed','cancelled','failed')
                     NOT NULL DEFAULT 'processing',
    total_sheets     INT UNSIGNED   NOT NULL DEFAULT 0,  -- images queued
    processed_sheets INT UNSIGNED   NOT NULL DEFAULT 0,  -- records written
    started_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at      DATETIME       NULL,
    PRIMARY KEY (session_id),
    KEY idx_session_faculty (faculty_id),
    KEY idx_session_answerkey (answer_key_id),
    KEY idx_session_status (status),
    CONSTRAINT fk_session_faculty
        FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_session_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- exam_sheet -- one row per scanned/captured answer sheet.
--
-- sheet_code is the coded identifier assigned on capture (per the
-- methodology), so a sheet can be referenced in results and reports
-- without exposing the student's identity. It is NOT NULL on purpose --
-- the de-identification requirement is part of the design, not an
-- optional extra. The backend must generate it on insert; a simple,
-- defensible pattern is:
--     CONCAT('AGS-', LPAD(<session_id>,4,'0'), '-', LPAD(<n>,4,'0'))
--
-- KNOWN REDUNDANCY, deliberate: answer_key_id is reachable two ways --
-- directly, and through grading_session. The direct link is kept because
-- the approved ERD has it and because the grading queries join sheets to
-- key items constantly; going through the session on every one of those
-- adds a join for nothing.
--
-- The cost is that the two could disagree. MySQL cannot express "these
-- must match" as a foreign key, so the backend MUST set
-- exam_sheet.answer_key_id from the session's answer_key_id and never
-- from user input. This query should always return zero rows:
--
--   SELECT es.sheet_id FROM exam_sheet es
--   JOIN grading_session gs ON gs.session_id = es.session_id
--   WHERE es.answer_key_id <> gs.answer_key_id;
-- ---------------------------------------------------------------------
CREATE TABLE exam_sheet (
    sheet_id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    session_id          INT UNSIGNED    NOT NULL,
    answer_key_id       INT UNSIGNED    NOT NULL,
    sheet_code          VARCHAR(50)     NOT NULL,   -- de-identified handle
    original_filename   VARCHAR(255)    NULL,
    image_path          VARCHAR(255)    NOT NULL,
    upload_date         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_status   ENUM('pending','preprocessing','segmented',
                             'recognized','graded','reviewed','completed','error')
                        NOT NULL DEFAULT 'pending',
    error_message       VARCHAR(255)    NULL,
    PRIMARY KEY (sheet_id),
    UNIQUE KEY uq_sheet_code (sheet_code),
    KEY idx_sheet_session (session_id),
    KEY idx_sheet_answerkey (answer_key_id),
    KEY idx_sheet_status (processing_status),
    CONSTRAINT fk_sheet_session
        FOREIGN KEY (session_id) REFERENCES grading_session (session_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_sheet_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- student_info -- the recognised identity block from each sheet.
--
-- Held separately from exam_sheet because these fields are HTR output
-- (recognised, uncertain) rather than system-known facts.
--
-- consent_status and participant_code implement the ethics requirements
-- written into Chapter 3 (RA 10173): only consenting sheets are
-- processed, and results are reported using a code, not the student's
-- name.
-- ---------------------------------------------------------------------
CREATE TABLE student_info (
    student_info_id     INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id            INT UNSIGNED    NOT NULL,
    name                VARCHAR(150)    NULL,   -- recognised; nullable
    name_confidence     DECIMAL(5,4)    NULL,   -- 0.0000-1.0000
    section             VARCHAR(50)     NULL,
    exam_date           DATE            NULL,
    consent_status      ENUM('consented','not_consented') NOT NULL DEFAULT 'consented',
    participant_code    VARCHAR(50)     NULL,   -- de-identified code used in results
    PRIMARY KEY (student_info_id),
    UNIQUE KEY uq_studentinfo_sheet (sheet_id),   -- one identity block per sheet
    KEY idx_studentinfo_participant (participant_code),
    CONSTRAINT chk_studentinfo_nameconf
        CHECK (name_confidence IS NULL OR (name_confidence >= 0 AND name_confidence <= 1)),
    CONSTRAINT fk_studentinfo_sheet
        FOREIGN KEY (sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- student_answer -- one row per detected answer region on a sheet.
--
-- Links a physical crop -> what the model read -> its confidence -> the
-- answer-key item it belongs to. This is the table the segmentation and
-- recognition modules write into, and the core of the pipeline.
--
-- model_used is per answer, not per run, because the thesis compares
-- recognition models and a run may use more than one.
-- ---------------------------------------------------------------------
CREATE TABLE student_answer (
    student_answer_id   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id            INT UNSIGNED    NOT NULL,
    item_id             INT UNSIGNED    NOT NULL,
    crop_path           VARCHAR(255)    NULL,
    recognized_text     TEXT            NULL,
    htr_confidence      DECIMAL(5,4)    NULL,   -- 0.0000-1.0000 (a fraction)
    model_used          VARCHAR(100)    NULL,
    recognized_at       DATETIME        NULL,
    PRIMARY KEY (student_answer_id),
    UNIQUE KEY uq_answer_sheet_item (sheet_id, item_id),
    KEY idx_answer_sheet (sheet_id),
    KEY idx_answer_item (item_id),
    KEY idx_answer_model (model_used),
    CONSTRAINT chk_answer_confidence
        CHECK (htr_confidence IS NULL OR (htr_confidence >= 0 AND htr_confidence <= 1)),
    CONSTRAINT fk_answer_sheet
        FOREIGN KEY (sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_answer_item
        FOREIGN KEY (item_id) REFERENCES answer_key_item (item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- grading_result -- the outcome per graded item.
--
-- status vs auto_status is the distinction the Review Flagged page
-- depends on, and it is what makes the accuracy claim measurable:
--   auto_status = what the system decided on its own (never overwritten)
--   status      = what stands now, after any human review
-- Keeping the original means raw model accuracy is still reportable
-- after a teacher has corrected the sheet -- which is exactly what the
-- Week 8 "manual-vs-automated grading comparison" needs. Do not collapse
-- these two columns.
--
-- Status codes vs. what the UI shows:
--   'correct'   <-> "OK"
--   'incorrect' <-> "Wrong"
--   'flagged'   <-> "Flagged"
--
-- match_score is a PERCENTAGE (0-100), matching
-- answer_key_item.fuzzy_threshold, so the grading check is direct:
--   match_score >= fuzzy_threshold
-- ---------------------------------------------------------------------
CREATE TABLE grading_result (
    result_id           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id            INT UNSIGNED    NOT NULL,
    item_id             INT UNSIGNED    NOT NULL,
    recognized_id       INT UNSIGNED    NULL,       -- FK to the student_answer scored
    score               DECIMAL(6,2)    NOT NULL DEFAULT 0.00,  -- points standing now
    auto_score          DECIMAL(6,2)    NOT NULL DEFAULT 0.00,  -- the machine's own
    status              ENUM('correct','incorrect','flagged') NOT NULL,
    auto_status         ENUM('correct','incorrect','flagged') NOT NULL,
    match_score         DECIMAL(5,2)    NULL,       -- percent 0-100
    is_manual_override  TINYINT(1)      NOT NULL DEFAULT 0,
    remarks             VARCHAR(255)    NULL,
    graded_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (result_id),
    UNIQUE KEY uq_result_sheet_item (sheet_id, item_id),
    KEY idx_result_sheet (sheet_id),
    KEY idx_result_item (item_id),
    KEY idx_result_recognized (recognized_id),
    KEY idx_result_status (status),
    KEY idx_result_flagged (sheet_id, status),   -- drives the Review queue
    KEY idx_result_autostatus (auto_status),     -- drives the accuracy analysis
    CONSTRAINT chk_result_match
        CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 100)),
    CONSTRAINT chk_result_score CHECK (score >= 0),
    CONSTRAINT fk_result_sheet
        FOREIGN KEY (sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_result_item
        FOREIGN KEY (item_id) REFERENCES answer_key_item (item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_result_recognized
        FOREIGN KEY (recognized_id) REFERENCES student_answer (student_answer_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
