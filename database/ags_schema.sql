-- =====================================================================
-- Automated Grading System for Handwritten Objective Examinations
-- Using Deep Learning
-- MySQL 8.0+ database schema
--
-- Engine: InnoDB (required for foreign keys)
-- Charset: utf8mb4 (full Unicode; handles all handwriting-derived text)
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- LAYER 1: Users and exam definition
-- ---------------------------------------------------------------------

-- Faculty: the system's users (renamed from "teacher" to match the
-- revised manuscript, which refers to participants as faculty).
CREATE TABLE faculty (
    faculty_id      INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    full_name       VARCHAR(150)    NOT NULL,
    username        VARCHAR(60)     NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,      -- store a hash, never plaintext
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (faculty_id),
    UNIQUE KEY uq_faculty_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Answer key: one per exam a faculty member sets up.
CREATE TABLE answer_key (
    answer_key_id   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    faculty_id      INT UNSIGNED    NOT NULL,
    subject         VARCHAR(150)    NOT NULL,
    year_level      VARCHAR(50)     NULL,
    section         VARCHAR(50)     NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (answer_key_id),
    KEY idx_answerkey_faculty (faculty_id),
    CONSTRAINT fk_answerkey_faculty
        FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Answer key item: the individual questions within a key.
-- question_type drives the grading logic:
--   'MC' / 'TF'            -> exact matching
--   'IDENTIFICATION'       -> fuzzy matching
--   'ENUMERATION'          -> fuzzy matching with enumeration grouping
CREATE TABLE answer_key_item (
    item_id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    answer_key_id       INT UNSIGNED    NOT NULL,
    item_no             INT UNSIGNED    NOT NULL,
    question_type       ENUM('MC','TF','IDENTIFICATION','ENUMERATION') NOT NULL,
    correct_answer      TEXT            NOT NULL,
    alternative_answers TEXT            NULL,   -- e.g. JSON/CSV of accepted variants
    fuzzy_threshold     DECIMAL(4,3)    NULL,   -- 0.000-1.000; NULL for exact-match types
    points              DECIMAL(6,2)    NOT NULL DEFAULT 1.00,
    PRIMARY KEY (item_id),
    UNIQUE KEY uq_item_key_no (answer_key_id, item_no),
    KEY idx_item_answerkey (answer_key_id),
    CONSTRAINT fk_item_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- LAYER 2: Physical sheets coming in
-- ---------------------------------------------------------------------

-- Exam sheet: one row per scanned/captured answer sheet.
-- sheet_code = the coded identifier assigned on capture (per methodology),
-- so a sheet can be referenced without exposing the student's identity.
CREATE TABLE exam_sheet (
    sheet_id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    answer_key_id       INT UNSIGNED    NOT NULL,
    sheet_code          VARCHAR(50)     NOT NULL,   -- de-identified handle
    image_path          VARCHAR(255)    NOT NULL,
    upload_date         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_status   ENUM('pending','preprocessing','segmented',
                             'recognized','graded','reviewed','completed','error')
                        NOT NULL DEFAULT 'pending',
    PRIMARY KEY (sheet_id),
    UNIQUE KEY uq_sheet_code (sheet_code),
    KEY idx_sheet_answerkey (answer_key_id),
    CONSTRAINT fk_sheet_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Student info: the recognized identity block from each sheet.
-- Held separately from exam_sheet because these fields are HTR output
-- (recognized, uncertain) rather than system-known facts.
-- consent_status and participant_code implement the revised ethics
-- requirements: only consenting + selected sheets are processed, and
-- results are reported using a code, not the student's name.
CREATE TABLE student_info (
    student_info_id     INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id            INT UNSIGNED    NOT NULL,
    name                VARCHAR(150)    NULL,       -- recognized; nullable
    section             VARCHAR(50)     NULL,
    exam_date           DATE            NULL,
    consent_status      ENUM('consented','not_consented') NOT NULL DEFAULT 'consented',
    participant_code    VARCHAR(50)     NULL,       -- de-identified code used in results
    PRIMARY KEY (student_info_id),
    UNIQUE KEY uq_studentinfo_sheet (sheet_id),      -- one identity block per sheet
    CONSTRAINT fk_studentinfo_sheet
        FOREIGN KEY (sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- LAYER 3: Extraction and grading
-- ---------------------------------------------------------------------

-- Student answer: one row per detected answer region on a sheet.
-- Links a physical crop -> what the model read -> its confidence -> the
-- answer-key item it belongs to. This is the core of the pipeline.
CREATE TABLE student_answer (
    student_answer_id   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id            INT UNSIGNED    NOT NULL,
    item_id             INT UNSIGNED    NOT NULL,
    crop_path           VARCHAR(255)    NULL,
    recognized_text     TEXT            NULL,
    htr_confidence      DECIMAL(5,4)    NULL,       -- 0.0000-1.0000
    PRIMARY KEY (student_answer_id),
    UNIQUE KEY uq_answer_sheet_item (sheet_id, item_id),
    KEY idx_answer_sheet (sheet_id),
    KEY idx_answer_item (item_id),
    CONSTRAINT fk_answer_sheet
        FOREIGN KEY (sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_answer_item
        FOREIGN KEY (item_id) REFERENCES answer_key_item (item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grading result: the outcome per graded item.
CREATE TABLE grading_result (
    result_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id        INT UNSIGNED    NOT NULL,
    item_id         INT UNSIGNED    NOT NULL,
    recognized_id   INT UNSIGNED    NULL,           -- FK to the student_answer scored
    score           DECIMAL(6,2)    NOT NULL DEFAULT 0.00,
    status          ENUM('correct','incorrect','flagged') NOT NULL,
    match_score     DECIMAL(5,4)    NULL,           -- fuzzy match strength, when applicable
    remarks         VARCHAR(255)    NULL,
    PRIMARY KEY (result_id),
    UNIQUE KEY uq_result_sheet_item (sheet_id, item_id),
    KEY idx_result_sheet (sheet_id),
    KEY idx_result_item (item_id),
    KEY idx_result_recognized (recognized_id),
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

-- Manual review: only the items flagged for human checking.
-- Not every grading_result has one -- only low-confidence / low-match items.
CREATE TABLE manual_review (
    review_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    result_id       INT UNSIGNED    NOT NULL,
    corrected_answer TEXT           NULL,
    final_score     DECIMAL(6,2)    NULL,
    review_status   ENUM('pending','reviewed','corrected') NOT NULL DEFAULT 'pending',
    reviewed_at     DATETIME        NULL,
    PRIMARY KEY (review_id),
    UNIQUE KEY uq_review_result (result_id),         -- at most one review per result
    CONSTRAINT fk_review_result
        FOREIGN KEY (result_id) REFERENCES grading_result (result_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- LAYER 4: Output
-- ---------------------------------------------------------------------

-- Report: the generated structured Excel export record.
CREATE TABLE report (
    report_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    answer_key_id   INT UNSIGNED    NOT NULL,
    generated_by    INT UNSIGNED    NOT NULL,        -- FK to faculty
    file_path       VARCHAR(255)    NOT NULL,
    generated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (report_id),
    KEY idx_report_answerkey (answer_key_id),
    KEY idx_report_faculty (generated_by),
    CONSTRAINT fk_report_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_report_faculty
        FOREIGN KEY (generated_by) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- Relationship summary
--   faculty          1--*  answer_key
--   answer_key       1--*  answer_key_item
--   answer_key       1--*  exam_sheet
--   exam_sheet       1--1  student_info
--   exam_sheet       1--*  student_answer
--   answer_key_item  1--*  student_answer
--   exam_sheet       1--*  grading_result
--   answer_key_item  1--*  grading_result
--   student_answer   1--1  grading_result   (via recognized_id)
--   grading_result   1--1  manual_review    (optional)
--   answer_key       1--*  report
--   faculty          1--*  report
-- =====================================================================
