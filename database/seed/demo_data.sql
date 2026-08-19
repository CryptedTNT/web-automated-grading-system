-- =====================================================================
-- demo_data.sql
-- Automated Grading System -- demo data
--
-- Loaded by:  .\tools\migrate.ps1 -LoginPath ags -Seed
-- (the runner refuses if the database already holds faculty rows)
--
-- This is NOT a migration. Sample data must never be applied to a
-- database holding real collected exam sheets -- the explicit primary
-- keys below would collide with real records.
--
-- One faculty account, one 10-item answer key covering all four question
-- types, and one completed session of three sheets that between them
-- exercise every path the system has: a clean sheet, a sheet with a
-- wrong answer and a fuzzy match that got flagged, and a sheet whose
-- flagged item a teacher already reviewed and accepted.
--
-- This is sample data for development and for the defense demo. Clear it
-- out before collecting real exam data in Week 7 -- from the mysql
-- client, `source bootstrap/99_reset.sql`, then re-run migrate.ps1
-- WITHOUT -Seed.
-- =====================================================================

SET NAMES utf8mb4;
USE ags_db;

-- ---------------------------------------------------------------------
-- Faculty
--
-- Login for the demo:  username `demo`  /  password `Password1!`
--
-- The hash below is computed the same way the current front end does it,
-- SHA256(password + ':' + salt), so this account works with the app as
-- it stands today. When the Flask backend switches to werkzeug or
-- bcrypt, regenerate this row -- do not carry SHA-256 into production.
-- ---------------------------------------------------------------------
INSERT INTO faculty
    (faculty_id, full_name, institution, username,
     password_hash, password_salt,
     security_question, security_answer_hash, security_answer_salt,
     created_at)
VALUES
    (1, 'Demo Faculty Account', 'Thesis University', 'demo',
     SHA2('Password1!:demosalt123456', 256), 'demosalt123456',
     'What is your favorite subject?',
     SHA2('biology:answersalt7890', 256), 'answersalt7890',
     '2026-03-01 08:00:00');

-- ---------------------------------------------------------------------
-- Answer key -- 10 items, 12 points total
-- ---------------------------------------------------------------------
INSERT INTO answer_key
    (answer_key_id, faculty_id, title, subject, year_level, section, created_at)
VALUES
    (1, 1, 'Midterm Examination', 'General Biology', 'Grade 11', 'STEM-A',
     '2026-03-05 09:15:00');

INSERT INTO answer_key_item
    (item_id, answer_key_id, item_no, question_type, enum_group,
     correct_answer, alternative_answers, fuzzy_threshold, points)
VALUES
    -- Exact-match types: no fuzzy threshold applies.
    ( 1, 1,  1, 'MC',             NULL, 'A',              NULL,           NULL, 1.00),
    ( 2, 1,  2, 'MC',             NULL, 'C',              NULL,           NULL, 1.00),
    ( 3, 1,  3, 'MC',             NULL, 'B',              NULL,           NULL, 1.00),
    ( 4, 1,  4, 'TF',             NULL, 'True',           'T',            NULL, 1.00),
    ( 5, 1,  5, 'TF',             NULL, 'False',          'F',            NULL, 1.00),
    -- Fuzzy-match types.
    ( 6, 1,  6, 'IDENTIFICATION', NULL, 'Mitochondrion',  'Mitochondria', 85.00, 2.00),
    ( 7, 1,  7, 'IDENTIFICATION', NULL, 'Photosynthesis', NULL,           85.00, 2.00),
    -- One enumeration question worth 3 points, answered in any order.
    ( 8, 1,  8, 'ENUMERATION',       1, 'Nitrogen',       NULL,           85.00, 1.00),
    ( 9, 1,  9, 'ENUMERATION',       1, 'Oxygen',         NULL,           85.00, 1.00),
    (10, 1, 10, 'ENUMERATION',       1, 'Carbon Dioxide', 'CO2',          85.00, 1.00);

-- ---------------------------------------------------------------------
-- One completed processing run
-- ---------------------------------------------------------------------
INSERT INTO grading_session
    (session_id, faculty_id, answer_key_id, session_name, source_folder,
     status, total_sheets, processed_sheets, started_at, finished_at)
VALUES
    (1, 1, 1, 'Session 2026-03-10 10:30:00', 'STEM-A Midterm Scans',
     'completed', 3, 3, '2026-03-10 10:30:00', '2026-03-10 10:34:12');

-- ---------------------------------------------------------------------
-- Sheets
--
-- sheet_code is the de-identified handle used everywhere downstream;
-- participant_code is what appears in exported results. The student's
-- recognised name is kept only so the teacher can match a physical
-- paper back to its record.
-- ---------------------------------------------------------------------
INSERT INTO exam_sheet
    (sheet_id, session_id, answer_key_id, sheet_code, original_filename,
     image_path, upload_date, processing_status)
VALUES
    (1, 1, 1, 'AGS-0001-0001', 'scan_001.jpg',
     'uploads/session_1/scan_001.jpg', '2026-03-10 10:30:05', 'completed'),
    (2, 1, 1, 'AGS-0001-0002', 'scan_002.jpg',
     'uploads/session_1/scan_002.jpg', '2026-03-10 10:31:40', 'completed'),
    (3, 1, 1, 'AGS-0001-0003', 'scan_003.jpg',
     'uploads/session_1/scan_003.jpg', '2026-03-10 10:33:02', 'reviewed');

INSERT INTO student_info
    (student_info_id, sheet_id, name, name_confidence, section, exam_date,
     consent_status, participant_code)
VALUES
    (1, 1, 'Ana Reyes',      0.9640, 'STEM-A', '2026-03-10', 'consented', 'P-001'),
    (2, 2, 'Ben Cruz',       0.9310, 'STEM-A', '2026-03-10', 'consented', 'P-002'),
    (3, 3, 'Carla Domingo',  0.8875, 'STEM-A', '2026-03-10', 'consented', 'P-003');

-- ---------------------------------------------------------------------
-- Recognised answers (what the HTR model read off each crop)
-- ---------------------------------------------------------------------
INSERT INTO student_answer
    (student_answer_id, sheet_id, item_id, crop_path, recognized_text,
     htr_confidence, model_used, recognized_at)
VALUES
    -- Sheet 1 -- clean read, every answer correct.
    ( 1, 1,  1, 'crops/s1_i01.png', 'A',              0.9910, 'CRNN-CTC v1', '2026-03-10 10:30:20'),
    ( 2, 1,  2, 'crops/s1_i02.png', 'C',              0.9880, 'CRNN-CTC v1', '2026-03-10 10:30:20'),
    ( 3, 1,  3, 'crops/s1_i03.png', 'B',              0.9845, 'CRNN-CTC v1', '2026-03-10 10:30:21'),
    ( 4, 1,  4, 'crops/s1_i04.png', 'True',           0.9720, 'CRNN-CTC v1', '2026-03-10 10:30:21'),
    ( 5, 1,  5, 'crops/s1_i05.png', 'False',          0.9690, 'CRNN-CTC v1', '2026-03-10 10:30:22'),
    ( 6, 1,  6, 'crops/s1_i06.png', 'Mitochondrion',  0.9450, 'CRNN-CTC v1', '2026-03-10 10:30:22'),
    ( 7, 1,  7, 'crops/s1_i07.png', 'Photosynthesis', 0.9520, 'CRNN-CTC v1', '2026-03-10 10:30:23'),
    ( 8, 1,  8, 'crops/s1_i08.png', 'Oxygen',         0.9600, 'CRNN-CTC v1', '2026-03-10 10:30:23'),
    ( 9, 1,  9, 'crops/s1_i09.png', 'Nitrogen',       0.9580, 'CRNN-CTC v1', '2026-03-10 10:30:24'),
    (10, 1, 10, 'crops/s1_i10.png', 'CO2',            0.9330, 'CRNN-CTC v1', '2026-03-10 10:30:24'),

    -- Sheet 2 -- one genuinely wrong answer (item 3) and one near-miss
    -- spelling the system will not accept on its own (item 6).
    (11, 2,  1, 'crops/s2_i01.png', 'A',              0.9870, 'CRNN-CTC v1', '2026-03-10 10:31:55'),
    (12, 2,  2, 'crops/s2_i02.png', 'C',              0.9790, 'CRNN-CTC v1', '2026-03-10 10:31:55'),
    (13, 2,  3, 'crops/s2_i03.png', 'D',              0.9810, 'CRNN-CTC v1', '2026-03-10 10:31:56'),
    (14, 2,  4, 'crops/s2_i04.png', 'True',           0.9650, 'CRNN-CTC v1', '2026-03-10 10:31:56'),
    (15, 2,  5, 'crops/s2_i05.png', 'False',          0.9610, 'CRNN-CTC v1', '2026-03-10 10:31:57'),
    (16, 2,  6, 'crops/s2_i06.png', 'Mitochondrian',  0.7420, 'CRNN-CTC v1', '2026-03-10 10:31:57'),
    (17, 2,  7, 'crops/s2_i07.png', 'Photosynthesis', 0.9410, 'CRNN-CTC v1', '2026-03-10 10:31:58'),
    (18, 2,  8, 'crops/s2_i08.png', 'Nitrogen',       0.9490, 'CRNN-CTC v1', '2026-03-10 10:31:58'),
    (19, 2,  9, 'crops/s2_i09.png', 'Oxygen',         0.9520, 'CRNN-CTC v1', '2026-03-10 10:31:59'),
    (20, 2, 10, 'crops/s2_i10.png', 'Carbon Dioxide', 0.9180, 'CRNN-CTC v1', '2026-03-10 10:31:59'),

    -- Sheet 3 -- messy handwriting on item 7; flagged, then reviewed.
    (21, 3,  1, 'crops/s3_i01.png', 'A',              0.9760, 'CRNN-CTC v1', '2026-03-10 10:33:15'),
    (22, 3,  2, 'crops/s3_i02.png', 'C',              0.9700, 'CRNN-CTC v1', '2026-03-10 10:33:15'),
    (23, 3,  3, 'crops/s3_i03.png', 'B',              0.9680, 'CRNN-CTC v1', '2026-03-10 10:33:16'),
    (24, 3,  4, 'crops/s3_i04.png', 'T',              0.9210, 'CRNN-CTC v1', '2026-03-10 10:33:16'),
    (25, 3,  5, 'crops/s3_i05.png', 'False',          0.9440, 'CRNN-CTC v1', '2026-03-10 10:33:17'),
    (26, 3,  6, 'crops/s3_i06.png', 'Mitochondria',   0.9050, 'CRNN-CTC v1', '2026-03-10 10:33:17'),
    (27, 3,  7, 'crops/s3_i07.png', 'Photosynthesus', 0.6180, 'CRNN-CTC v1', '2026-03-10 10:33:18'),
    (28, 3,  8, 'crops/s3_i08.png', 'Oxygen',         0.9370, 'CRNN-CTC v1', '2026-03-10 10:33:18'),
    (29, 3,  9, 'crops/s3_i09.png', 'Nitrogen',       0.9290, 'CRNN-CTC v1', '2026-03-10 10:33:19'),
    (30, 3, 10, 'crops/s3_i10.png', 'Carbon Dioxide', 0.9110, 'CRNN-CTC v1', '2026-03-10 10:33:19');

-- ---------------------------------------------------------------------
-- Grading results
--
-- auto_status/auto_score record what the system decided by itself and
-- are never rewritten; status/score are what stands after review. On
-- sheets 1 and 2 nothing was reviewed, so the pairs are identical.
--
-- Totals produced by v_sheet_result:
--   sheet 1 -- 12.00 / 12.00 = 100.00%,  0 flagged
--   sheet 2 --  9.00 / 12.00 =  75.00%,  1 flagged (item 6)
--   sheet 3 -- 12.00 / 12.00 = 100.00%,  0 flagged (item 7 accepted)
-- ---------------------------------------------------------------------
INSERT INTO grading_result
    (result_id, sheet_id, item_id, recognized_id, score, auto_score,
     status, auto_status, match_score, is_manual_override, remarks, graded_at)
VALUES
    -- Sheet 1
    ( 1, 1,  1,  1, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:30'),
    ( 2, 1,  2,  2, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:30'),
    ( 3, 1,  3,  3, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:30'),
    ( 4, 1,  4,  4, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:30'),
    ( 5, 1,  5,  5, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:30'),
    ( 6, 1,  6,  6, 2.00, 2.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:31'),
    ( 7, 1,  7,  7, 2.00, 2.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:30:31'),
    -- Enumeration: answers given out of order still score, because
    -- matching happens within enum_group, not per item_no.
    ( 8, 1,  8,  9, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Matched within enumeration group 1.', '2026-03-10 10:30:31'),
    ( 9, 1,  9,  8, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Matched within enumeration group 1.', '2026-03-10 10:30:31'),
    (10, 1, 10, 10, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Accepted alternative answer "CO2".',   '2026-03-10 10:30:31'),

    -- Sheet 2
    (11, 2,  1, 11, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:32:05'),
    (12, 2,  2, 12, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:32:05'),
    (13, 2,  3, 13, 0.00, 0.00, 'incorrect', 'incorrect',   0.00, 0, 'Answered D; correct answer is B.', '2026-03-10 10:32:05'),
    (14, 2,  4, 14, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:32:05'),
    (15, 2,  5, 15, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:32:05'),
    -- 92.31% clears the 85% threshold but is not an exact match, so the
    -- item is held for a human rather than scored automatically.
    (16, 2,  6, 16, 0.00, 0.00, 'flagged',   'flagged',    92.31, 0, 'Fuzzy match below exact; needs review.', '2026-03-10 10:32:06'),
    (17, 2,  7, 17, 2.00, 2.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:32:06'),
    (18, 2,  8, 18, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Matched within enumeration group 1.', '2026-03-10 10:32:06'),
    (19, 2,  9, 19, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Matched within enumeration group 1.', '2026-03-10 10:32:06'),
    (20, 2, 10, 20, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:32:06'),

    -- Sheet 3 -- item 7 was auto-flagged, then accepted by the teacher.
    -- auto_status stays 'flagged' so model accuracy is still measurable.
    (21, 3,  1, 21, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:33:30'),
    (22, 3,  2, 22, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:33:30'),
    (23, 3,  3, 23, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:33:30'),
    (24, 3,  4, 24, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Accepted alternative answer "T".', '2026-03-10 10:33:30'),
    (25, 3,  5, 25, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:33:30'),
    (26, 3,  6, 26, 2.00, 2.00, 'correct',   'correct',   100.00, 0, 'Accepted alternative answer "Mitochondria".', '2026-03-10 10:33:31'),
    (27, 3,  7, 27, 2.00, 0.00, 'correct',   'flagged',    92.86, 1,
         'Manual review: accepted as correct. Automatic result was flagged at 92.86% match.', '2026-03-10 10:33:31'),
    (28, 3,  8, 28, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Matched within enumeration group 1.', '2026-03-10 10:33:31'),
    (29, 3,  9, 29, 1.00, 1.00, 'correct',   'correct',   100.00, 0, 'Matched within enumeration group 1.', '2026-03-10 10:33:31'),
    (30, 3, 10, 30, 1.00, 1.00, 'correct',   'correct',   100.00, 0, NULL, '2026-03-10 10:33:31');

-- ---------------------------------------------------------------------
-- Manual review -- only the one item a human actually looked at
-- ---------------------------------------------------------------------
INSERT INTO manual_review
    (review_id, result_id, reviewed_by, override_action,
     original_answer, corrected_answer, final_score, review_status, reviewed_at)
VALUES
    (1, 27, 1, 'accepted_correct',
     'Photosynthesus', 'Photosynthesis', 2.00, 'corrected', '2026-03-10 10:40:15');

-- ---------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------
INSERT INTO report
    (report_id, answer_key_id, session_id, generated_by,
     file_name, file_path, generated_at)
VALUES
    (1, 1, 1, 1,
     'grading_session_1_2026-03-10.xlsx',
     'exports/grading_session_1_2026-03-10.xlsx', '2026-03-10 10:45:00');

-- ---------------------------------------------------------------------
-- Settings -- the same preferences the Settings page writes today
-- ---------------------------------------------------------------------
INSERT INTO app_setting (faculty_id, setting_key, setting_value)
VALUES
    (1, 'theme',       JSON_QUOTE('default')),
    (1, 'remember_me', JSON_QUOTE('false')),
    (1, 'export_preferences', JSON_OBJECT(
        'folder_label',           'Downloads',
        'filename_format',        'grading_session_{session}_{date}.xlsx',
        'include_student_info',   TRUE,
        'include_item_scores',    TRUE,
        'include_total_score',    TRUE,
        'include_flagged_notes',  TRUE,
        'include_question_type',  TRUE
    ));

-- ---------------------------------------------------------------------
-- Quick check -- run these after seeding.
-- Expect: 100.00 / 75.00 / 100.00 and flagged counts 0 / 1 / 0.
-- ---------------------------------------------------------------------
-- SELECT sheet_code, student_name, score, total, percentage, flagged_count, status
--   FROM v_sheet_result ORDER BY sheet_id;
-- SELECT * FROM v_session_summary;
-- SELECT * FROM v_dashboard_stats;
-- SELECT * FROM v_model_accuracy;
