-- =====================================================================
-- V005 -- Email address + code-based verification, replacing the
-- security-question flow for password reset.
--
-- WHY THIS EXISTS
--
-- The front end moved from "security question/answer" to "type the
-- 6-digit code we emailed you" for both first-time email verification
-- and forgotten-password recovery. Both flows are the same mechanism
-- (generate a code, hash it, email it, check it against what the
-- teacher types back), so one table serves both -- see the `purpose`
-- column.
--
-- security_question / security_answer_hash / security_answer_salt on
-- `faculty` are left untouched: no data loss for any existing account,
-- and the new flow simply never reads them. Written as a new migration
-- rather than an edit to V001, because V001 has already been applied --
-- that is the rule, and this is the ordinary case it exists for.
-- =====================================================================

ALTER TABLE faculty
    ADD COLUMN email          VARCHAR(255) NULL     AFTER username,
    ADD COLUMN email_verified TINYINT(1)   NOT NULL DEFAULT 0 AFTER email;

-- ---------------------------------------------------------------------
-- email_verification_code -- one row per code ever generated.
--
-- code_hash, never the raw code, same principle as password_hash --
-- a database leak must not hand out usable codes. Old rows are kept
-- (not deleted) after use/expiry so there is a record of every
-- verification/reset attempt if it's ever needed for the manuscript's
-- security discussion; `used_at` is what actually gates re-use.
-- ---------------------------------------------------------------------
CREATE TABLE email_verification_code (
    code_id     INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    faculty_id  INT UNSIGNED    NOT NULL,
    purpose     ENUM('verify_email', 'reset_password') NOT NULL,
    code_hash   VARCHAR(255)    NOT NULL,
    expires_at  DATETIME        NOT NULL,
    used_at     DATETIME        NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code_id),
    KEY idx_code_faculty_purpose (faculty_id, purpose),
    CONSTRAINT fk_code_faculty
        FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
