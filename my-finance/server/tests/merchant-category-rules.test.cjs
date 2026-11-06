const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMerchant, guessCategory } = require('../merchant-category-rules.cjs');

const categories = [
  { id: 1, name: 'Market', type: 'Expense' },
  { id: 2, name: 'Restoran', type: 'Expense' },
  { id: 3, name: 'Ulaşım', type: 'Expense' },
  { id: 4, name: 'Abonelik', type: 'Expense' },
  { id: 5, name: 'Faturalar', type: 'Expense' },
  { id: 6, name: 'Maaş', type: 'Income' },
];

test('normalizes Turkish merchant names and removes long account identifiers', () => {
  assert.equal(normalizeMerchant('ŞOK Market · Hesap 1234567890'), 'sok market');
});

test('maps known merchants only to matching user-owned categories and transaction types', () => {
  assert.deepEqual(guessCategory('MIGROS 123456789012', 'Expense', categories).category, categories[0]);
  assert.equal(guessCategory('Shell İstanbul', 'Expense', categories).category?.name, 'Ulaşım');
  assert.equal(guessCategory('Spotify Premium', 'Expense', categories).category?.name, 'Abonelik');
  assert.equal(guessCategory('Aylık maaş bordro', 'Income', categories).category?.name, 'Maaş');
  assert.equal(guessCategory('MIGROS', 'Income', categories).category, null);
});

test('does not invent a category for unknown merchants or absent user categories', () => {
  assert.equal(guessCategory('Bilinmeyen işyeri', 'Expense', categories).confidence, 'low');
  const result = guessCategory('Migros', 'Expense', []);
  assert.equal(result.category, null);
  assert.equal(result.confidence, 'medium');
});
