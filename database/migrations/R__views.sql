-- =====================================================================
-- R__views.sql -- REPEATABLE migration
--
-- WAIM Weeks 5-6 (August 24 - September 06, 2026)
--   Part of "Complete system development" / "Functional end-to-end
--   system prototype"
--
-- "Repeatable" means the runner re-applies this file whenever its
-- contents change, instead of once and never again. Every statement is
-- CREATE OR REPLACE, so re-running is safe. Views are the one thing that
-- gets edited repeatedly during development -- a new column on a report,
-- a different sort -- and forcing a new V-numbered file for each tweak
-- would bury the real schema history in noise.
--
-- Runs after every V-migration. Depends on V001-V003.
--
-- ---------------------------------------------------------------------
-- WHY THESE EXIST
--
-- The front end stores a per-sheet score, total, percentage, and flagged
-- count on the result row itself, and recalculates them by hand after
-- every manual review.
--
-- The database does NOT store those numbers. They are derived here
-- instead, so a total can never disagree with the item scores it is
-- supposed to summarise -- exactly the kind of inconsistency a panel
-- looks for. Adding a review updates one row; every total that depends
-- on it follows automatically.
--
-- Each view is shaped to match what a page needs, so the Flask backend
-- can usually SELECT one view instead of assembling joins by hand.
-- =====================================================================

-- ---------------------------------------------------------------------
-- v_sheet_result -- one row per graded sheet.
-- Feeds: Results page, Student Result header, Excel export.
-- Replaces the app's `ags_student_results` records.
-- ---------------------------------------------------------------------
-- original_filename/image_path/processing_status moved to exam_sheet_page
-- in V006 (a submission can span several page images) -- pulled back in
-- here as correlated subqueries rather than a JOIN, since a plain JOIN
-- against a one-to-many child table would fan out against the
-- grading_result JOIN below and corrupt the SUM()s. Page 1's file
-- represents the sheet for display; status is 'error' if any page
-- errored, 'completed' only once every page is, else 'preprocessing'.
CREATE OR REPLACE VIEW v_sheet_result AS
SELECT
    es.sheet_id                                     AS sheet_id,
    es.session_id                                   AS session_id,
    es.sheet_code                                   AS sheet_code,
    si.participant_code                             AS participant_code,
    si.name                                         AS student_name,
    si.section                                      AS section,
    si.consent_status                               AS consent_status,
    (SELECT esp.original_filename FROM exam_sheet_page esp
      WHERE esp.sheet_id = es.sheet_id ORDER BY esp.page_no LIMIT 1)   AS original_filename,
    (SELECT esp.image_path FROM exam_sheet_page esp
      WHERE esp.sheet_id = es.sheet_id ORDER BY esp.page_no LIMIT 1)   AS image_path,
    (SELECT CASE
        WHEN SUM(esp.processing_status = 'error') > 0 THEN 'error'
        WHEN SUM(esp.processing_status = 'completed') = COUNT(*) THEN 'completed'
        ELSE 'preprocessing'
     END FROM exam_sheet_page esp WHERE esp.sheet_id = es.sheet_id)    AS processing_status,
    COALESCE(SUM(gr.score), 0)                      AS score,
    COALESCE(SUM(aki.points), 0)                    AS total,
    CASE
        WHEN COALESCE(SUM(aki.points), 0) > 0
        THEN ROUND(SUM(gr.score) / SUM(aki.points) * 100, 2)
        ELSE 0
    END                                             AS percentage,
    COALESCE(SUM(gr.status = 'flagged'), 0)         AS flagged_count,
    COALESCE(SUM(gr.status = 'correct'), 0)         AS correct_count,
    COALESCE(SUM(gr.status = 'incorrect'), 0)       AS incorrect_count,
    -- The app's two-state sheet badge: "Flagged" if anything still needs
    -- a human, otherwise "OK".
    CASE
        WHEN COALESCE(SUM(gr.status = 'flagged'), 0) > 0 THEN 'Flagged'
        ELSE 'OK'
    END                                             AS status,
    es.upload_date                                  AS created_at
FROM exam_sheet es
LEFT JOIN student_info    si  ON si.sheet_id  = es.sheet_id
LEFT JOIN grading_result  gr  ON gr.sheet_id  = es.sheet_id
LEFT JOIN answer_key_item aki ON aki.item_id  = gr.item_id
GROUP BY
    es.sheet_id, es.session_id, es.sheet_code, si.participant_code,
    si.name, si.section, si.consent_status, es.upload_date;

-- ---------------------------------------------------------------------
-- v_result_item -- one row per graded item, fully denormalised.
-- Feeds: Student Result item table, Review Flagged page, Excel export.
-- Replaces the app's `ags_result_items` records.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_result_item AS
SELECT
    gr.result_id                    AS result_id,
    gr.sheet_id                     AS sheet_id,
    es.session_id                   AS session_id,
    es.sheet_code                   AS sheet_code,
    aki.item_id                     AS item_id,
    aki.item_no                     AS item_no,
    aki.question_type               AS question_type,
    -- The label the UI shows, so the page does not have to map it.
    CASE aki.question_type
        WHEN 'MC'             THEN 'Multiple Choice'
        WHEN 'TF'             THEN 'True or False'
        WHEN 'IDENTIFICATION' THEN 'Identification'
        WHEN 'ENUMERATION'    THEN 'Enumeration'
    END                             AS question_type_label,
    aki.enum_group                  AS enum_group,
    sa.recognized_text              AS student_answer,
    aki.correct_answer              AS correct_answer,
    aki.alternative_answers         AS alternatives,
    aki.fuzzy_threshold             AS fuzzy_threshold,
    gr.match_score                  AS match_score,
    aki.points                      AS points,
    gr.score                        AS earned,
    gr.status                       AS status,
    gr.auto_status                  AS auto_status,
    gr.auto_score                   AS auto_score,
    gr.is_manual_override           AS manual_override,
    mr.override_action              AS override_action,
    mr.review_status                AS review_status,
    mr.reviewed_at                  AS reviewed_at,
    gr.remarks                      AS remarks,
    sa.model_used                   AS model_used,
    sa.htr_confidence               AS confidence,
    sa.crop_path                    AS crop_path
FROM grading_result gr
JOIN exam_sheet      es  ON es.sheet_id  = gr.sheet_id
JOIN answer_key_item aki ON aki.item_id  = gr.item_id
LEFT JOIN student_answer sa ON sa.student_answer_id = gr.recognized_id
LEFT JOIN manual_review  mr ON mr.result_id         = gr.result_id;

-- ---------------------------------------------------------------------
-- v_flagged_queue -- every item still awaiting a human decision,
-- in the order the Review Flagged page walks them.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_flagged_queue AS
SELECT *
FROM v_result_item
WHERE status = 'flagged'
ORDER BY session_id, sheet_id, item_no;

-- ---------------------------------------------------------------------
-- v_session_summary -- one row per processing run.
-- Feeds: Dashboard recent-sessions list, Reports page.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_session_summary AS
SELECT
    gs.session_id                       AS session_id,
    gs.faculty_id                       AS faculty_id,
    gs.answer_key_id                    AS answer_key_id,
    ak.title                            AS answer_key_name,
    ak.subject                          AS subject,
    gs.session_name                     AS session_name,
    gs.source_folder                    AS source_folder,
    gs.status                           AS status,
    gs.total_sheets                     AS queued_sheets,
    COUNT(DISTINCT vsr.sheet_id)        AS graded_sheets,
    COALESCE(SUM(vsr.flagged_count), 0) AS flagged_items,
    ROUND(AVG(vsr.percentage), 2)       AS average_percentage,
    gs.started_at                       AS started_at,
    gs.finished_at                      AS finished_at
FROM grading_session gs
JOIN answer_key ak           ON ak.answer_key_id = gs.answer_key_id
LEFT JOIN v_sheet_result vsr ON vsr.session_id   = gs.session_id
GROUP BY
    gs.session_id, gs.faculty_id, gs.answer_key_id, ak.title, ak.subject,
    gs.session_name, gs.source_folder, gs.status, gs.total_sheets,
    gs.started_at, gs.finished_at;

-- ---------------------------------------------------------------------
-- v_dashboard_stats -- the four Dashboard tiles, one row per faculty.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
    f.faculty_id                                AS faculty_id,
    COUNT(DISTINCT gs.session_id)               AS sessions,
    COUNT(DISTINCT vsr.sheet_id)                AS sheets,
    COALESCE(SUM(vsr.flagged_count), 0)         AS flagged,
    COALESCE(ROUND(AVG(vsr.percentage), 2), 0)  AS average
FROM faculty f
LEFT JOIN grading_session gs  ON gs.faculty_id = f.faculty_id
LEFT JOIN v_sheet_result  vsr ON vsr.session_id = gs.session_id
GROUP BY f.faculty_id;

-- ---------------------------------------------------------------------
-- v_model_accuracy -- raw machine accuracy, ignoring human corrections.
--
-- This is the view the thesis's accuracy claim comes from, and the
-- starting point for the Week 8 manual-vs-automated comparison. It reads
-- auto_status, never status, so grading stays measurable after teachers
-- have reviewed the sheets.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_model_accuracy AS
SELECT
    es.session_id                                       AS session_id,
    aki.question_type                                   AS question_type,
    sa.model_used                                       AS model_used,
    COUNT(*)                                            AS items_graded,
    SUM(gr.auto_status = 'correct')                     AS auto_correct,
    SUM(gr.auto_status = 'incorrect')                   AS auto_incorrect,
    SUM(gr.auto_status = 'flagged')                     AS auto_flagged,
    SUM(gr.is_manual_override = 1)                      AS overridden_by_human,
    ROUND(SUM(gr.auto_status = 'correct') / COUNT(*) * 100, 2)
                                                        AS auto_correct_pct,
    ROUND(AVG(sa.htr_confidence), 4)                    AS mean_htr_confidence,
    ROUND(AVG(gr.match_score), 2)                       AS mean_match_score
FROM grading_result gr
JOIN exam_sheet      es  ON es.sheet_id = gr.sheet_id
JOIN answer_key_item aki ON aki.item_id = gr.item_id
LEFT JOIN student_answer sa ON sa.student_answer_id = gr.recognized_id
GROUP BY es.session_id, aki.question_type, sa.model_used;
