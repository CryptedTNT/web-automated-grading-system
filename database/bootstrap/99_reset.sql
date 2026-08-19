-- =====================================================================
-- 99_reset.sql -- DESTRUCTIVE RESET
--
-- ***  THIS DELETES EVERY TABLE AND ALL DATA IN ags_db.  ***
--
-- Use it only to rebuild a development database from scratch. Afterwards
-- the migration ledger is gone too, so tools\migrate.ps1 will replay
-- V001 -> V002 -> V003 -> R__views from nothing.
--
-- Run it from the mysql client (PowerShell has no `<` redirection):
--     mysql -u root -p
--     mysql> source bootstrap/99_reset.sql
--     mysql> EXIT;
--     PS> .\tools\migrate.ps1 -LoginPath ags -Seed
--
-- ---------------------------------------------------------------------
-- STOP AND READ THIS FROM WEEK 7 ONWARD
--
-- Once real handwritten exam sheets have been collected from CCS faculty,
-- this script destroys data that took consent forms, scheduling, and a
-- Campus Director approval to obtain, and which cannot be regenerated.
-- There is no undo.
--
-- Back up first, every time:
--   mysqldump -u root -p --databases ags_db --routines --triggers ^
--             --result-file=ags_backup_YYYY-MM-DD.sql
--
-- If your goal is to change the schema rather than wipe it, you do NOT
-- want this file. Write a new V-migration instead -- that is the entire
-- reason the migration system exists.
-- =====================================================================

USE ags_db;

-- Views first: they depend on the tables below.
DROP VIEW IF EXISTS v_model_accuracy;
DROP VIEW IF EXISTS v_dashboard_stats;
DROP VIEW IF EXISTS v_session_summary;
DROP VIEW IF EXISTS v_flagged_queue;
DROP VIEW IF EXISTS v_result_item;
DROP VIEW IF EXISTS v_sheet_result;

-- Dropped in reverse dependency order, so the foreign key check stays on
-- and a genuine mistake in the order is caught rather than silently
-- allowed.
SET FOREIGN_KEY_CHECKS = 1;

DROP TABLE IF EXISTS app_setting;
DROP TABLE IF EXISTS report;
DROP TABLE IF EXISTS manual_review;
DROP TABLE IF EXISTS grading_result;
DROP TABLE IF EXISTS student_answer;
DROP TABLE IF EXISTS student_info;
DROP TABLE IF EXISTS exam_sheet;
DROP TABLE IF EXISTS grading_session;
DROP TABLE IF EXISTS answer_key_item;
DROP TABLE IF EXISTS answer_key;
DROP TABLE IF EXISTS faculty;

-- The ledger goes last. Dropping it is what makes the migration runner
-- treat the database as brand new.
DROP TABLE IF EXISTS schema_migration;

-- Confirm the database is empty:
--   SHOW TABLES;
