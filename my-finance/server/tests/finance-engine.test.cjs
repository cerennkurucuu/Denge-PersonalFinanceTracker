const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFinancialPlan, analyzeSpending, transactionImpact } = require('../finance-engine.cjs');

const categories = [
  { name: 'Restoran', monthlyAverage: 2_000_000, protectedAmount: 0, reductionRate: 0.5 },
  { name: 'Konut', monthlyAverage: 2_000_000, protectedAmount: 1_900_000, reductionRate: 0.5 },
];

test('builds three scenario values from the 45,000 / 49,200 / 3,000 test case', () => {
  const plan = buildFinancialPlan({ monthlyIncome: 4_500_000, monthlyExpense: 4_920_000, targetSavings: 300_000, categories });
  assert.equal(plan.currentNet, -420_000);
  assert.equal(plan.currentDeficit, 420_000);
  assert.equal(plan.requiredImprovement, 720_000);
  assert.equal(plan.scenarios[0].requestedImprovement, 300_000);
  assert.equal(plan.scenarios[0].plannedExpense, 4_620_000);
  assert.equal(plan.scenarios[0].remainingDeficit, 120_000);
  assert.equal(plan.scenarios[1].requestedImprovement, 720_000);
  assert.equal(plan.scenarios[1].netAfterPlan, 300_000);
  assert.equal(plan.scenarios[2].requestedImprovement, 1_000_000);
  assert.equal(plan.scenarios[2].netAfterPlan, 580_000);
});

test('never recommends reducing protected costs or exceeding category capacity', () => {
  const plan = buildFinancialPlan({ monthlyIncome: 4_500_000, monthlyExpense: 4_920_000, targetSavings: 300_000, categories: [{ name: 'Konut', monthlyAverage: 1_000_000, protectedAmount: 950_000, reductionRate: 0.5 }] });
  assert.equal(plan.totalReductionCapacity, 25_000);
  assert.equal(plan.feasible, false);
  assert.ok(plan.scenarios.every(scenario => scenario.attainableImprovement <= 25_000));
  assert.ok(plan.scenarios.every(scenario => scenario.categoryTargets.every(target => target.monthlyLimit >= 950_000)));
});

test('preserves category identifiers so plan targets can be persisted and tracked', () => {
  const plan = buildFinancialPlan({ monthlyIncome: 500_000, monthlyExpense: 600_000, targetSavings: 0, categories: [{ categoryId: 42, name: 'Market', monthlyAverage: 300_000, protectedAmount: 0, reductionRate: 0.5 }] });
  assert.ok(plan.scenarios[1].categoryTargets.some(target => target.category === 'Market'));
  assert.equal(plan.categories[0].categoryId, 42);
});

test('handles zero, negative and invalid amounts safely', () => {
  const plan = buildFinancialPlan({ monthlyIncome: 0, monthlyExpense: 0, targetSavings: -10, categories: [{ name: 'Diğer', monthlyAverage: -1, protectedAmount: 0, reductionRate: 2 }] });
  assert.equal(plan.currentNet, 0);
  assert.equal(plan.requiredImprovement, 0);
  assert.equal(plan.totalReductionCapacity, 0);
  assert.equal(plan.feasible, true);
});

test('refund reduces expense and transfer/card payment are excluded from consumption totals', () => {
  assert.deepEqual(transactionImpact({ type: 'Expense', amount: 10_000, entry_kind: 'refund' }), { income: 0, expense: -10_000 });
  assert.deepEqual(transactionImpact({ type: 'Expense', amount: 10_000, entry_kind: 'transfer' }), { income: 0, expense: 0 });
  assert.deepEqual(transactionImpact({ type: 'Expense', amount: 10_000, entry_kind: 'card_payment' }), { income: 0, expense: 0 });
});

test('does not create reliable habit findings or forecast when history is short', () => {
  const result = analyzeSpending([{ type: 'Expense', amount: 100_00, category: 'Restoran', description: 'Kafe', merchant_name: 'Kafe', transaction_date: '2026-11-01', entry_kind: 'standard' }], { today: new Date('2026-11-06T00:00:00Z') });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.forecast, null);
});

test('compares repeated merchants to the previous 30 days only when the history spans enough active weeks', () => {
  const today = new Date('2026-11-06T00:00:00Z');
  const entries = [];
  for (let day = 35; day <= 41; day += 1) entries.push({ type: 'Expense', amount: 1_000, category: 'Restoran', merchant_name: 'Ada Kafe', transaction_date: new Date(today.valueOf() - day * 86_400_000).toISOString().slice(0, 10) });
  for (let day = 1; day <= 18; day += 1) entries.push({ type: 'Expense', amount: 1_000, category: 'Restoran', merchant_name: 'Ada Kafe', transaction_date: new Date(today.valueOf() - day * 86_400_000).toISOString().slice(0, 10) });
  for (const day of [45, 52, 59, 66, 73, 80, 87, 94]) entries.push({ type: 'Expense', amount: 500, category: 'Diğer', description: `Harcama ${day}`, transaction_date: new Date(today.valueOf() - day * 86_400_000).toISOString().slice(0, 10) });
  const result = analyzeSpending(entries, { today });
  assert.equal(result.hasEnoughHistory, true);
  const cafe = result.repeatedMerchants.find(item => item.merchant === 'Ada Kafe');
  assert.equal(cafe.count, 18);
  assert.equal(cafe.previous30DayCount, 7);
  assert.ok(result.recommendations.some(item => item.kind === 'repeat_merchant' && item.currentCount === 18 && item.previousCount === 7));
});

test('includes refunds in net category and weekday/weekend spending instead of treating them as income', () => {
  const today = new Date('2026-11-06T00:00:00Z');
  const entries = [
    { type: 'Expense', amount: 10_000, category: 'Market', description: 'Alışveriş', transaction_date: '2026-11-05' },
    { type: 'Expense', amount: 2_500, category: 'Market', description: 'İade', entry_kind: 'refund', transaction_date: '2026-11-05' },
  ];
  const result = analyzeSpending(entries, { today });
  assert.equal(result.windowTotals[30].expense, 7_500);
  assert.equal(result.weekendVsWeekday.weekday, 7_500);
  assert.equal(result.windowTotals[30].income, 0);
});

test('ignores future transactions in habit and forecast analysis', () => {
  const result = analyzeSpending([{ type: 'Expense', amount: 99_999, category: 'Market', description: 'Gelecek işlem', transaction_date: '2026-12-01' }], { today: new Date('2026-11-06T00:00:00Z') });
  assert.equal(result.historyDays, 0);
  assert.deepEqual(result.windowTotals[30], { income: 0, expense: 0 });
  assert.equal(result.forecast, null);
});

test('compares complete three- and six-month periods while requiring enough transaction history', () => {
  const today = new Date('2026-11-06T00:00:00Z');
  const entries = [];
  for (let offset = 12; offset >= 1; offset -= 1) {
    const date = new Date(Date.UTC(2026, 10 - offset, 1)).toISOString().slice(0, 10);
    const recentQuarter = offset <= 3;
    entries.push({ type: 'Income', amount: recentQuarter ? 120_000 : 100_000, transaction_date: date });
    entries.push({ type: 'Expense', amount: recentQuarter ? 130_000 : 100_000, transaction_date: date });
  }
  const result = analyzeSpending(entries, { today });
  const threeMonths = result.periodChanges.find(item => item.months === 3);
  const sixMonths = result.periodChanges.find(item => item.months === 6);
  assert.equal(threeMonths.sufficientHistory, true);
  assert.equal(threeMonths.incomeChangeRate, 0.2);
  assert.equal(threeMonths.expenseChangeRate, 0.3);
  assert.equal(sixMonths.sufficientHistory, true);
  assert.equal(sixMonths.incomeChangeRate, 0.1);
  assert.equal(sixMonths.expenseChangeRate, 0.15);
});
