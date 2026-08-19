-- =====================================================================
-- V001 -- Core users and exam definition
--
-- WAIM Week 3 (August 10-16, 2026)
--   Planned: "Begin system development (front-end and database
--             integration)" / "Initial system modules and database set up"
--
-- Layer 1 of the approved ERD: who uses the system, and how an exam is
-- defined. Nothing here depends on a scanned sheet existing, so it is
-- the natural first slice -- the Answer Keys page can be built and
-- tested against this alone.
--
-- Applied by tools\migrate.ps1. Do not edit after it has been applied:
-- the runner stores a checksum and will refuse to continue if a file
-- that already ran has changed. Write a new migration instead.
-- =====================================================================

-- ---------------------------------------------------------------------
-- faculty -- the system's users.
-- (Named "faculty" per the revised manuscript; the ERD's "Teacher" box
--  and the front end's `ags_users` key are the same entity.)
-- ---------------------------------------------------------------------
CREATE TABLE faculty (
    faculty_id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    full_name               VARCHAR(150)    NOT NULL,
    institution             VARCHAR(150)    NULL,
    username                VARCHAR(60)     NOT NULL,
    password_hash           VARCHAR(255)    NOT NULL,   -- a hash, never plaintext
    password_salt           VARCHAR(64)     NULL,       -- see note below
    security_question       VARCHAR(255)    NULL,
    security_answer_hash    VARCHAR(255)    NULL,       -- hashed, never plaintext
    security_answer_salt    VARCHAR(64)     NULL,
    is_active               TINYINT(1)      NOT NULL DEFAULT 1,
    last_login_at           DATETIME        NULL,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (faculty_id),
    UNIQUE KEY uq_faculty_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE on password_salt: the current front end hashes as
--   SHA256(password + ':' + salt)  and stores the salt beside the hash.
-- That column exists so browser-created accounts survive the move to the
-- database. When the Flask backend takes over, use
-- werkzeug.security.generate_password_hash() or bcrypt instead -- those
-- embed the salt inside password_hash, and password_salt simply stays
-- NULL. Pick one scheme and state which in the manuscript.

-- ---------------------------------------------------------------------
-- answer_key -- one per exam a faculty member sets up.
-- ---------------------------------------------------------------------
CREATE TABLE answer_key (
    answer_key_id   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    faculty_id      INT UNSIGNED    NOT NULL,
    title           VARCHAR(150)    NOT NULL DEFAULT 'Untitled Answer Key',
    subject         VARCHAR(150)    NOT NULL,
    year_level      VARCHAR(50)     NULL,
    section         VARCHAR(50)     NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (answer_key_id),
    KEY idx_answerkey_faculty (faculty_id),
    CONSTRAINT fk_answerkey_faculty
        FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- answer_key_item -- the individual questions within a key.
--
-- question_type drives the grading logic:
--   'MC' / 'TF'        -> exact matching
--   'IDENTIFICATION'   -> fuzzy matching
--   'ENUMERATION'      -> fuzzy matching, grouped by enum_group,
--                         order within a group does not matter
--
-- Stored codes vs. what the UI shows -- the backend maps between them:
--   'MC'             <-> "Multiple Choice"
--   'TF'             <-> "True or False"
--   'IDENTIFICATION' <-> "Identification"
--   'ENUMERATION'    <-> "Enumeration"
--
-- fuzzy_threshold is a PERCENTAGE (0-100, default 85), not the
-- 0.000-1.000 fraction in the draft ERD. The app's Answer Key editor
-- collects 85, and How To Use documents "70-99% is flagged". Keeping one
-- scale everywhere removes a conversion that is easy to get wrong.
-- grading_result.match_score (V002) uses the same scale.
-- ---------------------------------------------------------------------
CREATE TABLE answer_key_item (
    item_id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    answer_key_id       INT UNSIGNED    NOT NULL,
    item_no             INT UNSIGNED    NOT NULL,
    question_type       ENUM('MC','TF','IDENTIFICATION','ENUMERATION') NOT NULL,
    enum_group          INT UNSIGNED    NULL,   -- ENUMERATION only
    correct_answer      TEXT            NOT NULL,
    alternative_answers TEXT            NULL,   -- accepted variants, one per line or CSV
    fuzzy_threshold     DECIMAL(5,2)    NULL DEFAULT 85.00,
    points              DECIMAL(6,2)    NOT NULL DEFAULT 1.00,
    PRIMARY KEY (item_id),
    UNIQUE KEY uq_item_key_no (answer_key_id, item_no),
    KEY idx_item_answerkey (answer_key_id),
    KEY idx_item_enumgroup (answer_key_id, enum_group),
    CONSTRAINT chk_item_threshold
        CHECK (fuzzy_threshold IS NULL OR (fuzzy_threshold >= 0 AND fuzzy_threshold <= 100)),
    CONSTRAINT chk_item_points CHECK (points >= 0),
    -- A group number is only meaningful for enumeration items; the app
    -- discards it for every other type, so the database says so too.
    CONSTRAINT chk_item_enumgroup
        CHECK (enum_group IS NULL OR question_type = 'ENUMERATION'),
    CONSTRAINT fk_item_answerkey
        FOREIGN KEY (answer_key_id) REFERENCES answer_key (answer_key_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
