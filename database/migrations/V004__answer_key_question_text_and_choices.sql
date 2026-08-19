-- =====================================================================
-- V004 -- Question text and multiple-choice options on key items
--
-- WAIM Week 4 (August 17-23, 2026)
--   Follows the front-end commit "Add enumeration answer matching and
--   question text/choices storage" (bbf5520).
--
-- WHY THIS EXISTS
--
-- The answer key stopped being only a marking guide. The Answer Keys
-- page now prints the examination paper itself from these records, so
-- each item has to carry the question as the student reads it, and --
-- for multiple choice -- the four options. Without these columns the
-- printable sheet cannot be reproduced from the database, only from
-- whichever browser happened to create it.
--
-- Written as a new migration rather than an edit to V001, because V001
-- has already been applied. That is the rule, and this is the ordinary
-- case it exists for: the front end moved, so the schema follows.
-- =====================================================================

ALTER TABLE answer_key_item
    -- The question as printed on the sheet. NULL-able because the app
    -- allows a key to be saved with the text still blank -- it warns and
    -- prints blank spaces rather than blocking the teacher mid-entry.
    ADD COLUMN question_text TEXT NULL AFTER question_type,

    -- Multiple-choice options, stored as {"a": "...", "b": "...",
    -- "c": "...", "d": "..."} to match the shape the front end already
    -- reads and writes. JSON rather than four VARCHAR columns because
    -- the option set is a single value the app handles as a unit, and a
    -- future five-option question would otherwise need a migration and a
    -- rewrite of every query that names choice_a..choice_d.
    ADD COLUMN choices JSON NULL AFTER question_text;

-- Options belong to multiple-choice items and nothing else. The front
-- end already stores NULL for every other type, so this states the same
-- rule where it cannot be forgotten -- and mirrors chk_item_enumgroup
-- from V001, which does the same job for enumeration groups.
ALTER TABLE answer_key_item
    ADD CONSTRAINT chk_item_choices
        CHECK (choices IS NULL OR question_type = 'MC');

-- Existing rows keep NULL for both columns, which is correct: keys
-- created before this change genuinely have no question text recorded.
-- Nothing is back-filled with invented content.
