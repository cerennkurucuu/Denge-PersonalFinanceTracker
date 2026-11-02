ALTER TABLE transactions
  ADD COLUMN original_amount BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER amount;

ALTER TABLE transactions
  ADD COLUMN currency_code CHAR(3) NOT NULL DEFAULT 'TRY' AFTER original_amount;

ALTER TABLE transactions
  ADD COLUMN exchange_rate DECIMAL(24,10) NOT NULL DEFAULT 1 AFTER currency_code;

ALTER TABLE transactions
  ADD COLUMN tcmb_rate DECIMAL(24,10) NULL AFTER exchange_rate;

ALTER TABLE transactions
  ADD COLUMN rate_source ENUM('TRY','TCMB','manual') NOT NULL DEFAULT 'TRY' AFTER exchange_rate;

ALTER TABLE transactions
  ADD COLUMN rate_effective_date DATE NULL AFTER rate_source;

UPDATE transactions SET original_amount=amount WHERE original_amount=0;

CREATE TABLE IF NOT EXISTS exchange_rate_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  currency_code CHAR(3) NOT NULL,
  original_amount BIGINT UNSIGNED NOT NULL,
  try_amount BIGINT UNSIGNED NOT NULL,
  applied_rate DECIMAL(24,10) NOT NULL,
  tcmb_rate DECIMAL(24,10) NULL,
  rate_source ENUM('TRY','TCMB','manual') NOT NULL,
  rate_effective_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX exchange_rate_logs_transaction (transaction_id,created_at,id),
  CONSTRAINT exchange_rate_logs_transaction_fk FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT exchange_rate_logs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
