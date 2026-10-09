-- =====================================================================
-- V008 -- Class sections, student rosters, and name checks
--
-- A teacher registers the sections they handle, and the students in
-- each section (typed, read from a photographed list, or imported from
-- an Excel file). After a submission is graded, its recognised section
-- and name are checked against that roster:
--   matched    -- the name equals exactly one roster student
--   suggested  -- the name is close to one roster student; the teacher
--                 must confirm it is the same student
--   unmatched  -- no usable match (or the section is not on the
--                 teacher's list); the teacher must assign a student
--   confirmed  -- the teacher confirmed or assigned the student
-- NULL roster_status means the teacher has no sections, so the check
-- does not apply to that sheet.
-- =====================================================================

CREATE TABLE class_section (
    section_id      INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    faculty_id      INT UNSIGNED    NOT NULL,
    section_name    VARCHAR(50)     NOT NULL,   -- canonical form, e.g. "BSCS 1-A"
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (section_id),
    UNIQUE KEY uq_section_faculty_name (faculty_id, section_name),
    CONSTRAINT fk_section_faculty
        FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE roster_student (
    roster_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    section_id      INT UNSIGNED    NOT NULL,
    full_name       VARCHAR(150)    NOT NULL,
    position        INT UNSIGNED    NOT NULL,   -- display order within the section
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (roster_id),
    KEY idx_roster_section_position (section_id, position),
    CONSTRAINT fk_roster_section
        FOREIGN KEY (section_id) REFERENCES class_section (section_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- detected_name keeps what the handwriting model read, even after the
-- name is replaced by the roster spelling on a match or confirmation.
ALTER TABLE student_info
    ADD COLUMN detected_name VARCHAR(150) NULL AFTER name,
    ADD COLUMN section_id INT UNSIGNED NULL AFTER section,
    ADD COLUMN roster_id INT UNSIGNED NULL AFTER section_id,
    ADD COLUMN roster_status ENUM('matched','suggested','unmatched','confirmed') NULL AFTER roster_id,
    ADD COLUMN roster_score DECIMAL(5,2) NULL AFTER roster_status,
    ADD KEY idx_studentinfo_section (section_id),
    ADD KEY idx_studentinfo_roster (roster_id),
    ADD CONSTRAINT chk_studentinfo_roster_score
        CHECK (roster_score IS NULL OR (roster_score >= 0 AND roster_score <= 100)),
    ADD CONSTRAINT fk_studentinfo_section
        FOREIGN KEY (section_id) REFERENCES class_section (section_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    ADD CONSTRAINT fk_studentinfo_roster
        FOREIGN KEY (roster_id) REFERENCES roster_student (roster_id)
        ON UPDATE CASCADE ON DELETE SET NULL;
