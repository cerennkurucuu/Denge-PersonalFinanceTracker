ALTER TABLE categories
  MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE transactions
  MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE settings
  MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE categories
  ADD UNIQUE KEY categories_id_user (id,user_id);

ALTER TABLE transactions
  ADD UNIQUE KEY transactions_id_user (id,user_id);

ALTER TABLE transactions
  DROP FOREIGN KEY transactions_category_fk;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_category_user_fk
  FOREIGN KEY (category_id,user_id) REFERENCES categories(id,user_id) ON DELETE RESTRICT;

ALTER TABLE exchange_rate_logs
  ADD KEY exchange_rate_logs_transaction_user (transaction_id,user_id);

ALTER TABLE exchange_rate_logs
  DROP FOREIGN KEY exchange_rate_logs_transaction_fk;

ALTER TABLE exchange_rate_logs
  ADD CONSTRAINT exchange_rate_logs_transaction_user_fk
  FOREIGN KEY (transaction_id,user_id) REFERENCES transactions(id,user_id) ON DELETE CASCADE;
