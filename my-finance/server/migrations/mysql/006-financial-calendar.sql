CREATE TABLE IF NOT EXISTS calendar_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(100) NOT NULL,
  type ENUM('Income','Expense') NOT NULL,
  kind VARCHAR(24) NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  frequency ENUM('none','daily','weekly','monthly','yearly') NOT NULL DEFAULT 'none',
  start_date DATE NOT NULL,
  end_date DATE NULL,
  is_fixed TINYINT(1) NOT NULL DEFAULT 1,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY calendar_plans_id_user (id,user_id),
  KEY calendar_plans_user_dates (user_id,archived_at,start_date),
  CONSTRAINT calendar_plans_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT calendar_plans_category_fk FOREIGN KEY (category_id,user_id) REFERENCES categories(id,user_id) ON DELETE RESTRICT,
  CONSTRAINT calendar_plans_positive CHECK (amount>0),
  CONSTRAINT calendar_plans_dates CHECK (end_date IS NULL OR end_date>=start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendar_occurrences (
  plan_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  occurrence_date DATE NOT NULL,
  status ENUM('linked','reserved','skipped') NOT NULL,
  transaction_id BIGINT UNSIGNED NULL,
  title VARCHAR(100) NOT NULL,
  type ENUM('Income','Expense') NOT NULL,
  kind VARCHAR(24) NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_id,occurrence_date),
  UNIQUE KEY calendar_occurrence_transaction (transaction_id,user_id),
  KEY calendar_occurrences_user_date (user_id,occurrence_date),
  CONSTRAINT calendar_occurrences_plan_fk FOREIGN KEY (plan_id,user_id) REFERENCES calendar_plans(id,user_id) ON DELETE CASCADE,
  CONSTRAINT calendar_occurrences_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT calendar_occurrences_transaction_fk FOREIGN KEY (transaction_id,user_id) REFERENCES transactions(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendar_alert_dismissals (
  user_id BIGINT UNSIGNED NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,fingerprint),
  CONSTRAINT calendar_alert_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
