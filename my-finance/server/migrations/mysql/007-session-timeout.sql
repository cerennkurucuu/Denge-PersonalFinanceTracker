ALTER TABLE settings ADD COLUMN session_timeout_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10;

ALTER TABLE auth_sessions ADD COLUMN last_activity_at BIGINT UNSIGNED NOT NULL DEFAULT 0;

UPDATE auth_sessions SET last_activity_at=UNIX_TIMESTAMP() WHERE last_activity_at=0;
