CREATE TABLE IF NOT EXISTS statement_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  file_name VARCHAR(120) NOT NULL,
  source_count INT UNSIGNED NOT NULL DEFAULT 0,
  imported_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY statement_imports_file (user_id,file_sha256),
  UNIQUE KEY statement_imports_id_user (id,user_id),
  CONSTRAINT statement_imports_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE transactions ADD COLUMN entry_kind ENUM('standard','refund') NOT NULL DEFAULT 'standard';
ALTER TABLE transactions ADD COLUMN merchant_name VARCHAR(120) NULL;
ALTER TABLE transactions ADD COLUMN import_fingerprint CHAR(64) NULL;
ALTER TABLE transactions ADD COLUMN import_batch_id BIGINT UNSIGNED NULL;
ALTER TABLE transactions ADD UNIQUE KEY transactions_import_fingerprint (user_id,import_fingerprint);
ALTER TABLE transactions ADD KEY transactions_import_batch_user (import_batch_id,user_id);
ALTER TABLE transactions ADD CONSTRAINT transactions_import_batch_fk FOREIGN KEY (import_batch_id) REFERENCES statement_imports(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS merchant_category_rules (
  user_id BIGINT UNSIGNED NOT NULL,
  normalized_merchant VARCHAR(120) NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,normalized_merchant),
  CONSTRAINT merchant_rules_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT merchant_rules_category_user_fk FOREIGN KEY (category_id,user_id) REFERENCES categories(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plan_category_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  protected_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reduction_rate DECIMAL(5,4) NOT NULL DEFAULT 0.3500,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,category_id),
  CONSTRAINT plan_preferences_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT plan_preferences_category_user_fk FOREIGN KEY (category_id,user_id) REFERENCES categories(id,user_id) ON DELETE CASCADE,
  CONSTRAINT plan_preferences_rate CHECK (reduction_rate>=0 AND reduction_rate<=0.8000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_savings BIGINT UNSIGNED NOT NULL DEFAULT 0,
  requested_improvement BIGINT UNSIGNED NOT NULL DEFAULT 0,
  planned_improvement BIGINT UNSIGNED NOT NULL DEFAULT 0,
  category_targets MEDIUMTEXT NOT NULL,
  input_snapshot MEDIUMTEXT NOT NULL,
  status ENUM('active','completed','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX financial_plans_user_status (user_id,status,created_at),
  UNIQUE KEY financial_plans_id_user (id,user_id),
  CONSTRAINT financial_plans_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT financial_plans_dates CHECK (end_date>=start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  recommendation_fingerprint CHAR(64) NOT NULL,
  action ENUM('accepted','rejected','dismissed') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY recommendation_feedback_once (user_id,recommendation_fingerprint),
  CONSTRAINT recommendation_feedback_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plan_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plan_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  recorded_on DATE NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  spent_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  target_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY plan_progress_daily (plan_id,recorded_on,category_id),
  CONSTRAINT plan_progress_plan_user_fk FOREIGN KEY (plan_id,user_id) REFERENCES financial_plans(id,user_id) ON DELETE CASCADE,
  CONSTRAINT plan_progress_category_user_fk FOREIGN KEY (category_id,user_id) REFERENCES categories(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
