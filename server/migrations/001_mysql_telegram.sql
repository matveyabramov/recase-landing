-- Run once in an EMPTY dedicated shared-hosting Beget MySQL database.
-- MySQL 5.7+/8.x, InnoDB. No DBaaS, credentials or applicant data here.
CREATE TABLE IF NOT EXISTS recase_schema (
    version INT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recase_leads (
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(120) NOT NULL,
    contact VARCHAR(160) NOT NULL,
    lead_type ENUM('participant','partner') NOT NULL,
    received_at BIGINT UNSIGNED NOT NULL COMMENT 'UTC Unix seconds',
    consent_given TINYINT UNSIGNED NOT NULL,
    consent_version VARCHAR(64) CHARACTER SET ascii NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL COMMENT 'UTC Unix seconds',
    notification_mode ENUM('anonymous','full') NOT NULL DEFAULT 'anonymous',
    delivery_status ENUM('pending','sending','sent','failed','uncertain') NOT NULL DEFAULT 'pending',
    delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at BIGINT UNSIGNED NOT NULL,
    delivery_started_at BIGINT UNSIGNED NULL,
    claim_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    last_error_code VARCHAR(64) CHARACTER SET ascii NULL,
    telegram_message_id BIGINT UNSIGNED NULL,
    INDEX recase_due (delivery_status,next_attempt_at),
    INDEX recase_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- HMAC only: never raw IP, name or contact in rate state.
CREATE TABLE IF NOT EXISTS recase_rate_buckets (
    ip_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    touched_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS recase_rate_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ip_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    received_at BIGINT UNSIGNED NOT NULL,
    INDEX recase_rate_window (ip_key,received_at),
    CONSTRAINT recase_rate_bucket FOREIGN KEY (ip_key)
        REFERENCES recase_rate_buckets(ip_key) ON DELETE CASCADE
) ENGINE=InnoDB;
INSERT IGNORE INTO recase_schema(version) VALUES (1);
