-- =====================================================================
-- V009 -- Flag a sheet that already has a graded record for the same
-- student on the same questionnaire.
--
-- A teacher can upload the same student's exam twice by mistake (a
-- stray re-scan, a page re-added to the wrong queue). This does not
-- block the second upload -- the match is based on OCR/roster identity,
-- which is sometimes wrong, so the teacher stays in control -- it only
-- records which earlier sheet it looks like a repeat of, so Results and
-- Student Result can warn about it instead of silently creating a
-- second record for the same exam.
-- =====================================================================

ALTER TABLE student_info
    ADD COLUMN duplicate_of_sheet_id INT UNSIGNED NULL AFTER roster_score,
    ADD KEY idx_studentinfo_duplicate (duplicate_of_sheet_id),
    ADD CONSTRAINT fk_studentinfo_duplicate
        FOREIGN KEY (duplicate_of_sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE SET NULL;
