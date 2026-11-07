ALTER TABLE settings ADD COLUMN allow_duplicate_imports TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE transactions ADD COLUMN deduplication_key CHAR(64) NULL;

ALTER TABLE transactions DROP INDEX transactions_import_fingerprint;

ALTER TABLE transactions ADD KEY transactions_import_fingerprint (user_id,import_fingerprint);

ALTER TABLE transactions ADD UNIQUE KEY transactions_import_dedupe_key (user_id,deduplication_key);

ALTER TABLE statement_imports ADD KEY statement_imports_user (user_id);

ALTER TABLE statement_imports DROP INDEX statement_imports_file;

ALTER TABLE statement_imports ADD KEY statement_imports_file (user_id,file_sha256);
