BEGIN IMMEDIATE;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

ALTER TABLE transactions RENAME TO transactions_legacy;
ALTER TABLE categories RENAME TO categories_legacy;
ALTER TABLE settings RENAME TO settings_legacy;

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('Income','Expense')),
  color TEXT NOT NULL DEFAULT '#64748b',
  icon TEXT NOT NULL DEFAULT 'circle',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  UNIQUE(user_id,name,type)
);
INSERT INTO categories(id,user_id,name,type,color,icon,is_default)
SELECT id,NULL,name,type,color,icon,is_default FROM categories_legacy;

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('Income','Expense')),
  amount INTEGER NOT NULL CHECK(amount>0),
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  transaction_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO transactions(id,user_id,type,amount,description,category_id,transaction_date,created_at,updated_at)
SELECT id,NULL,type,amount,description,category_id,transaction_date,created_at,updated_at FROM transactions_legacy;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'TRY',
  theme TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark')),
  language TEXT NOT NULL DEFAULT 'tr'
);
INSERT INTO settings(id,user_id,currency,theme,language)
SELECT id,NULL,currency,theme,language FROM settings_legacy;

DROP TABLE transactions_legacy;
DROP TABLE categories_legacy;
DROP TABLE settings_legacy;
COMMIT;
