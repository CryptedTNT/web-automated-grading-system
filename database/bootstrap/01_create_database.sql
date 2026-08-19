-- =====================================================================
-- 01_create_database.sql
-- Automated Grading System for Handwritten Objective Examinations
--
-- Creates the database and the dedicated application account.
-- RUN THIS ONCE, as the MySQL root user.
--
--   mysql -u root -p < 01_create_database.sql
--
-- Requires MySQL 8.0.16 or newer (CHECK constraints are enforced from
-- 8.0.16; on older versions they are parsed and ignored).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS ags_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
-- Application account.
--
-- The backend connects as this user, NOT as root. It is granted only
-- data rights on ags_db -- it cannot drop the schema, touch other
-- databases, or create users. If the app is ever compromised, the blast
-- radius stops at this one database.
--
-- CHANGE THE PASSWORD BELOW before using this outside your own machine,
-- and keep the real one in the backend's .env file (never in git).
-- ---------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'ags_app'@'localhost'
    IDENTIFIED BY 'ChangeMe_AGS_2026!';

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ags_db.*
    TO 'ags_app'@'localhost';

FLUSH PRIVILEGES;

-- Verify:
--   SHOW DATABASES LIKE 'ags_db';
--   SHOW GRANTS FOR 'ags_app'@'localhost';
