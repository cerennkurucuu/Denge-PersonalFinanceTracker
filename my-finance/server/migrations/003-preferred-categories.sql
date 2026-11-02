ALTER TABLE categories
  ADD COLUMN is_preferred INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0, 1));

UPDATE categories
SET is_preferred = 1
WHERE user_id IS NOT NULL
  AND id = (
    SELECT candidate.id
    FROM categories AS candidate
    WHERE candidate.user_id = categories.user_id
      AND candidate.type = categories.type
    ORDER BY CASE
      WHEN candidate.is_default = 1
        AND ((candidate.type = 'Expense' AND candidate.name = 'Market')
          OR (candidate.type = 'Income' AND candidate.name = 'Maaş')) THEN 0
      WHEN candidate.is_default = 1 THEN 1
      ELSE 2
    END, candidate.id
    LIMIT 1
  );

CREATE UNIQUE INDEX categories_one_preferred_per_user_type
  ON categories(user_id, type)
  WHERE is_preferred = 1 AND user_id IS NOT NULL;
