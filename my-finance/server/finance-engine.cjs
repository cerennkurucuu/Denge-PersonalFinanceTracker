const DAY_MS = 86_400_000;
const TRY_KURUS = 100;
const ROUNDING_STEP_KURUS = 100_000;

const toDate = value => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
};

function transactionImpact(transaction) {
  if (transaction.entry_kind === 'transfer' || transaction.entry_kind === 'card_payment') return { income: 0, expense: 0 };
  const amount = Number(transaction.amount) || 0;
  if (transaction.entry_kind === 'refund') return { income: 0, expense: -amount };
  return transaction.type === 'Income' ? { income: amount, expense: 0 } : { income: 0, expense: amount };
}

function roundToTry(value) {
  return Math.round(value / ROUNDING_STEP_KURUS) * ROUNDING_STEP_KURUS;
}

function allocateTargets(target, categories) {
  const positive = categories.filter(category => category.savingCapacity > 0);
  const capacity = positive.reduce((sum, category) => sum + category.savingCapacity, 0);
  let remaining = Math.min(target, capacity);
  const output = positive.map((category, index) => {
    const portion = index === positive.length - 1
      ? remaining
      : Math.min(category.savingCapacity, Math.floor(Math.min(target, capacity) * category.savingCapacity / capacity));
    remaining -= portion;
    return { category: category.name, monthlyLimit: Math.max(0, category.monthlyAverage - portion), monthlyReduction: portion };
  });
  return output;
}

function buildFinancialPlan({ monthlyIncome, monthlyExpense, targetSavings, categories = [] }) {
  const income = Math.max(0, Math.round(Number(monthlyIncome) || 0));
  const expense = Math.max(0, Math.round(Number(monthlyExpense) || 0));
  const savingsGoal = Math.max(0, Math.round(Number(targetSavings) || 0));
  const deficit = income - expense;
  const requiredImprovement = Math.max(0, expense - income + savingsGoal);
  const normalizedCategories = categories.map(category => {
    const average = Math.max(0, Math.round(Number(category.monthlyAverage) || 0));
    const protectedAmount = Math.min(average, Math.max(0, Math.round(Number(category.protectedAmount) || 0)));
    const reductionRate = Math.min(0.8, Math.max(0, Number(category.reductionRate) || 0));
    return {
      name: String(category.name || 'Diğer'),
      categoryId: Number.isSafeInteger(category.categoryId) && category.categoryId > 0 ? category.categoryId : null,
      monthlyAverage: average,
      protectedAmount,
      reductionRate,
      savingCapacity: Math.max(0, Math.floor((average - protectedAmount) * reductionRate)),
      protectedByUser: Boolean(category.protectedByUser),
    };
  });
  const totalCapacity = normalizedCategories.reduce((sum, item) => sum + item.savingCapacity, 0);
  const requested = [
    { id: 'relaxed', label: 'Rahat', improvement: roundToTry(requiredImprovement * 0.4) },
    { id: 'balanced', label: 'Dengeli', improvement: requiredImprovement },
    { id: 'aggressive', label: 'İddialı', improvement: roundToTry(requiredImprovement + savingsGoal) },
  ];
  const scenarios = requested.map(scenario => {
    const attainableImprovement = Math.min(scenario.improvement, totalCapacity);
    const plannedExpense = Math.max(0, expense - attainableImprovement);
    return {
      id: scenario.id,
      label: scenario.label,
      requestedImprovement: scenario.improvement,
      attainableImprovement,
      attainable: attainableImprovement >= scenario.improvement,
      plannedExpense,
      netAfterPlan: income - plannedExpense,
      monthlySavings: Math.max(0, income - plannedExpense),
      remainingDeficit: Math.max(0, plannedExpense - income),
      categoryTargets: allocateTargets(attainableImprovement, normalizedCategories),
    };
  });
  return {
    monthlyIncome: income,
    monthlyExpense: expense,
    targetSavings: savingsGoal,
    currentNet: deficit,
    currentDeficit: Math.max(0, -deficit),
    requiredImprovement,
    totalReductionCapacity: totalCapacity,
    feasible: totalCapacity >= requiredImprovement,
    categories: normalizedCategories,
    scenarios,
    explanation: totalCapacity >= requiredImprovement
      ? 'Hedef, tanımlanan kategori azaltma kapasiteleri içinde karşılanabiliyor.'
      : 'Kategori bazlı azaltma kapasitesi hedef için yeterli değil. Gelir artışı, daha uzun süre veya farklı bir birikim hedefi gerekebilir.',
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function shiftedMonthKey(date, offset) {
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function analyzeSpending(transactions, { today = new Date(), minimumHistoryDays = 90 } = {}) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end.valueOf() - minimumHistoryDays * DAY_MS);
  const valid = transactions.filter(transaction => {
    const date = toDate(transaction.transaction_date);
    return date && date <= end;
  });
  const window = days => valid.filter(transaction => {
    const date = toDate(transaction.transaction_date);
    return date <= end && date >= new Date(end.valueOf() - days * DAY_MS);
  });
  const last30 = window(30);
  const previous30 = valid.filter(transaction => {
    const date = toDate(transaction.transaction_date);
    return date < new Date(end.valueOf() - 30 * DAY_MS) && date >= new Date(end.valueOf() - 60 * DAY_MS);
  });
  const previous90 = valid.filter(transaction => {
    const date = toDate(transaction.transaction_date);
    return date < new Date(end.valueOf() - 30 * DAY_MS) && date >= new Date(end.valueOf() - 120 * DAY_MS);
  });
  const historyDays = valid.reduce((max, transaction) => Math.max(max, end.valueOf() - toDate(transaction.transaction_date).valueOf()), 0) / DAY_MS;
  const weeksWithActivity = new Set(valid.filter(transaction => transaction.type === 'Expense' && !['transfer', 'card_payment'].includes(transaction.entry_kind)).map(transaction => Math.floor((end.valueOf() - toDate(transaction.transaction_date).valueOf()) / (7 * DAY_MS)))).size;
  const enoughHistory = historyDays >= minimumHistoryDays && weeksWithActivity >= 8;
  const expenses = list => list.filter(transaction => transaction.type === 'Expense' && !['transfer', 'card_payment'].includes(transaction.entry_kind));
  const merchantKey = transaction => String(transaction.merchant_name || transaction.description || '').trim().toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const merchantTotals = new Map();
  for (const transaction of expenses(last30).filter(item => item.entry_kind !== 'refund')) {
    const key = merchantKey(transaction);
    if (!key) continue;
    const record = merchantTotals.get(key) || { key, merchant: transaction.merchant_name || transaction.description, count: 0, amount: 0 };
    record.count += 1;
    record.amount += Number(transaction.amount) || 0;
    merchantTotals.set(key, record);
  }
  const repeatMerchants = [...merchantTotals.values()].filter(item => item.count >= 3).sort((a, b) => b.amount - a.amount);
  const previousCounts = new Map();
  for (const transaction of expenses(previous30).filter(item => item.entry_kind !== 'refund')) {
    const key = merchantKey(transaction);
    if (key) previousCounts.set(key, (previousCounts.get(key) || 0) + 1);
  }

  const categorySums = list => {
    const sums = new Map();
    for (const item of expenses(list)) {
      const key = String(item.category || 'Diğer');
      sums.set(key, (sums.get(key) || 0) + (item.entry_kind === 'refund' ? -(Number(item.amount) || 0) : (Number(item.amount) || 0)));
    }
    return sums;
  };
  const currentByCategory = categorySums(last30);
  const priorByCategory = categorySums(previous90);
  const categoryChanges = [...currentByCategory].map(([category, current]) => {
    const averageMonthly = (priorByCategory.get(category) || 0) / 3;
    const changeRate = averageMonthly > 0 ? (current - averageMonthly) / averageMonthly : null;
    return { category, current30Days: current, prior90DayMonthlyAverage: Math.round(averageMonthly), changeRate };
  }).filter(item => item.changeRate !== null && item.changeRate >= 0.3).sort((a, b) => b.changeRate - a.changeRate);

  const recommendations = [];
  if (enoughHistory) {
    for (const item of categoryChanges) recommendations.push({
      kind: 'category_increase', category: item.category, changeRate: Number(item.changeRate.toFixed(4)), currentAmount: item.current30Days,
      current30Days: item.current30Days, prior90DayMonthlyAverage: item.prior90DayMonthlyAverage,
      explanation: `${item.category} harcaman son 30 günde, önceki 90 günün aylık ortalamasından %${Math.round(item.changeRate * 100)} yüksek.`,
      expectedImpact: null, confidence: 'medium',
    });
    for (const item of repeatMerchants) {
      const previousCount = previousCounts.get(item.key) || 0;
      if (previousCount && item.count > previousCount) recommendations.push({
        kind: 'repeat_merchant', merchant: item.merchant, currentCount: item.count, previousCount, currentAmount: item.amount,
        explanation: `Son 30 günde ${item.merchant} noktasında ${item.count} işlem var; önceki 30 günde ${previousCount} işlem görünüyordu.`,
        expectedImpact: null, confidence: 'medium',
      });
    }
  }

  const signedExpense = item => item.entry_kind === 'refund' ? -Number(item.amount || 0) : Number(item.amount || 0);
  const weekend = expenses(last30).filter(item => [0, 6].includes(toDate(item.transaction_date).getUTCDay())).reduce((sum, item) => sum + signedExpense(item), 0);
  const weekday = expenses(last30).reduce((sum, item) => sum + signedExpense(item), 0) - weekend;
  const recurringMerchantRows = new Map();
  for (const transaction of expenses(window(120)).filter(item => item.entry_kind !== 'refund')) {
    const key = merchantKey(transaction);
    if (!key) continue;
    const group = recurringMerchantRows.get(key) || { merchant: transaction.merchant_name || transaction.description, dates: [], amounts: [] };
    group.dates.push(toDate(transaction.transaction_date));
    group.amounts.push(Number(transaction.amount) || 0);
    recurringMerchantRows.set(key, group);
  }
  const merchantSubscriptions = enoughHistory ? [...recurringMerchantRows.values()].filter(item => {
    if (item.dates.length < 2) return false;
    const dated = item.dates.sort((a, b) => a - b);
    const regularGap = dated.slice(1).some((date, index) => {
      const days = Math.round((date.valueOf() - dated[index].valueOf()) / DAY_MS);
      return days >= 25 && days <= 35;
    });
    const typical = median(item.amounts);
    const similarAmounts = typical > 0 && item.amounts.every(amount => Math.abs(amount - typical) / typical <= 0.1);
    return regularGap && similarAmounts;
  }).map(item => ({ merchant: item.merchant, count: item.dates.length, amount: Math.round(median(item.amounts)) })) : [];

  const monthly = new Map();
  for (const transaction of valid) {
    const date = toDate(transaction.transaction_date);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = monthly.get(key) || { income: 0, expense: 0 };
    const impact = transactionImpact(transaction);
    row.income += impact.income;
    row.expense += impact.expense;
    monthly.set(key, row);
  }
  const periodChanges = [3, 6].map(months => {
    const currentMonths = Array.from({ length: months }, (_, index) => shiftedMonthKey(end, -months + index));
    const comparisonMonths = Array.from({ length: months }, (_, index) => shiftedMonthKey(end, -2 * months + index));
    const sum = keys => keys.reduce((total, key) => {
      const value = monthly.get(key) || { income: 0, expense: 0 };
      total.income += value.income;
      total.expense += value.expense;
      return total;
    }, { income: 0, expense: 0 });
    const current = sum(currentMonths);
    const prior = sum(comparisonMonths);
    const sufficientHistory = historyDays >= months * 2 * 30 && weeksWithActivity >= 8;
    return {
      months,
      currentIncome: current.income,
      priorIncome: prior.income,
      currentExpense: current.expense,
      priorExpense: prior.expense,
      incomeChangeRate: sufficientHistory && prior.income > 0 ? (current.income - prior.income) / prior.income : null,
      expenseChangeRate: sufficientHistory && prior.expense > 0 ? (current.expense - prior.expense) / prior.expense : null,
      sufficientHistory,
      currentMonths,
      comparisonMonths,
    };
  });
  const fullMonths = [...monthly].filter(([key]) => key !== `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`).sort(([a], [b]) => a.localeCompare(b)).slice(-3);
  const consecutiveMonths = fullMonths.length === 3 && fullMonths.every(([key], index) => index === 0 || (() => {
    const previous = fullMonths[index - 1][0].split('-').map(Number);
    const current = key.split('-').map(Number);
    return current[0] * 12 + current[1] === previous[0] * 12 + previous[1] + 1;
  })());
  const forecast = enoughHistory && consecutiveMonths ? {
    income: Math.round(median(fullMonths.map(([, value]) => value.income))),
    expense: Math.round(median(fullMonths.map(([, value]) => value.expense))),
    basisMonths: fullMonths.map(([key]) => key),
    confidence: 'low',
    explanation: 'Tahmin son üç tamamlanmış ayın ortanca toplamlarına dayanır; düzensiz veya tek seferlik hareketleri kesin öngöremez.',
  } : null;
  const windowTotals = Object.fromEntries([30, 60, 90].map(days => [days, window(days).reduce((sum, item) => {
    const impact = transactionImpact(item);
    sum.income += impact.income;
    sum.expense += impact.expense;
    return sum;
  }, { income: 0, expense: 0 })]));
  return {
    historyDays: Math.max(0, Math.floor(historyDays)),
    confidence: enoughHistory ? 'medium' : 'low',
    hasEnoughHistory: enoughHistory,
    windowTotals,
    repeatedMerchants: repeatMerchants.map(item => ({ ...item, previous30DayCount: previousCounts.get(item.key) || 0 })),
    categoryChanges,
    weekendVsWeekday: { weekend, weekday, days: 30 },
    possibleSubscriptions: merchantSubscriptions.map(item => ({ ...item, note: 'Ödeme düzenli görünüyor; yalnızca işlem verisiyle aboneliğin kullanılıp kullanılmadığı belirlenemez.' })),
    recommendations,
    forecast,
    monthlyHistory: [...monthly].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, value]) => ({ month, ...value })),
    periodChanges,
  };
}

module.exports = { buildFinancialPlan, analyzeSpending, transactionImpact, allocateTargets, median, TRY_KURUS };
