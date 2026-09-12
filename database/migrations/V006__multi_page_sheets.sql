-- =====================================================================
-- V006 -- Multi-page exam sheets
--
-- WHY THIS EXISTS
--
-- exam_sheet has meant "one row = one uploaded image = one complete,
-- independently-graded submission" since V002. A real exam can span
-- several physical pages (only the first has the Name/Section/Date/
-- Score header; continuation pages are blank by design -- no QR code,
-- no repeated header, since printing is just plain extra copies), and
-- there was no way to record that three uploaded images belong to the
-- same student at all.
--
-- This splits that in two: exam_sheet now means "one student's whole
-- submission" (the grading/identity aggregation point -- student_info,
-- student_answer, and grading_result already key off sheet_id, so they
-- need no change at all, since sheet_id now just means "the group").
-- exam_sheet_page is the new one-row-per-physical-image table, carrying
-- exactly the columns that only ever made sense per-image.
--
-- The database holds no real data yet (the seeded demo account and its
-- rows were cleared during account testing), so this drops and moves
-- columns directly rather than migrating data around.
-- =====================================================================

-- ---------------------------------------------------------------------
-- exam_sheet_page -- one row per physical page image within a
-- submission. page_no is 1-based in the order the pages were uploaded
-- /captured; page 1 is the only one expected to carry a recognisable
-- Name/Section header (see app/inference/pipeline.py's run_sheet_group,
-- which pools every page's detections in page order before grading, so
-- page boundaries never need to be known item-by-item).
-- ---------------------------------------------------------------------
CREATE TABLE exam_sheet_page (
    page_id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sheet_id            INT UNSIGNED    NOT NULL,
    page_no             TINYINT UNSIGNED NOT NULL,
    original_filename   VARCHAR(255)    NULL,
    image_path          VARCHAR(255)    NOT NULL,
    processing_status   ENUM('pending','preprocessing','segmented',
                             'recognized','graded','reviewed','completed','error')
                        NOT NULL DEFAULT 'pending',
    error_message       VARCHAR(255)    NULL,
    uploaded_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (page_id),
    UNIQUE KEY uq_sheetpage_sheet_pageno (sheet_id, page_no),
    KEY idx_sheetpage_status (processing_status),
    CONSTRAINT fk_sheetpage_sheet
        FOREIGN KEY (sheet_id) REFERENCES exam_sheet (sheet_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- exam_sheet loses everything that only ever described one image.
-- idx_sheet_status also goes with processing_status -- exam_sheet_page
-- has its own equivalent index now.
-- ---------------------------------------------------------------------
ALTER TABLE exam_sheet
    DROP INDEX idx_sheet_status,
    DROP COLUMN original_filename,
    DROP COLUMN image_path,
    DROP COLUMN processing_status,
    DROP COLUMN error_message;
