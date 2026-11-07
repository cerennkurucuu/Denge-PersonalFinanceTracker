const crypto = require('node:crypto');
const DAY = 86400000;
const key = item => `${item.plan_id}|${item.occurrence_date}`;
const utc = date => new Date(`${date}T00:00:00Z`);
const iso = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => iso(new Date(utc(date).getTime() + days * DAY));
const dayDiff = (from, to) => Math.round((utc(to) - utc(from)) / DAY);
const safe = value => {
  if (!Number.isSafeInteger(value)) throw Object.assign(new Error('Unsafe cashflow amount'), { status: 422, publicMessage: 'Nakit akışı tutarı güvenli hesaplama sınırını aşıyor.' });
  return value;
};

function occurrenceDate(plan, index) {
  if (plan.frequency === 'none') return index === 0 ? plan.start_date : null;
  if (plan.frequency === 'daily' || plan.frequency === 'weekly') return addDays(plan.start_date, index * (plan.frequency === 'weekly' ? 7 : 1));
  const start = utc(plan.start_date);
  const year = start.getUTCFullYear() + (plan.frequency === 'yearly' ? index : 0);
  const month = start.getUTCMonth() + (plan.frequency === 'monthly' ? index : 0);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), last))));
}

function firstIndex(plan, from) {
  const start = utc(plan.start_date), date = utc(from);
  if (plan.frequency === 'daily' || plan.frequency === 'weekly') return Math.max(0, Math.floor(dayDiff(plan.start_date, from) / (plan.frequency === 'weekly' ? 7 : 1)));
  if (plan.frequency === 'monthly') return Math.max(0, (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + date.getUTCMonth() - start.getUTCMonth());
  if (plan.frequency === 'yearly') return Math.max(0, date.getUTCFullYear() - start.getUTCFullYear());
  return 0;
}

function isOccurrence(plan, date) {
  if (date < plan.start_date || (plan.end_date && date > plan.end_date)) return false;
  const index = firstIndex(plan, date);
  return occurrenceDate(plan, index) === date;
}

function expandPlans(plans, states, from, to) {
  const saved = new Map(states.map(item => [key(item), item]));
  const result = new Map();
  for (const plan of plans) {
    if (plan.archived_at) continue;
    for (let index = firstIndex(plan, from); ; index++) {
      const date = occurrenceDate(plan, index);
      if (!date || date > to || (plan.end_date && date > plan.end_date)) break;
      if (date < from) continue;
      const occurrence = { plan_id: Number(plan.id), occurrence_date: date, title: plan.title, type: plan.type, kind: plan.kind, amount: Number(plan.amount), category_id: plan.category_id === null ? null : Number(plan.category_id), frequency: plan.frequency, is_fixed: !!plan.is_fixed, status: 'pending', transaction_id: null };
      result.set(key(occurrence), { ...occurrence, ...saved.get(key(occurrence)), amount: Number(saved.get(key(occurrence))?.amount ?? occurrence.amount) });
      if (result.size > 20000) throw Object.assign(new Error('Too many occurrences'), { status: 422, publicMessage: '20.000 bekleyen takvim kaydı sınırına ulaşıldı. Eski planları kapatıp tarih aralığını daralt.' });
    }
  }
  // Completed snapshots survive edits and archival of their parent plan.
  for (const item of states) if (item.occurrence_date >= from && item.occurrence_date <= to) result.set(key(item), { ...result.get(key(item)), ...item, amount: Number(item.amount), plan_id: Number(item.plan_id), transaction_id: item.transaction_id === null ? null : Number(item.transaction_id) });
  if (result.size > 20000) throw Object.assign(new Error('Too many calendar snapshots'), {status:422,publicMessage:'Bu aralıkta 20.000 takvim kaydı sınırı aşıldı. Tarih aralığını daralt.'});
  return [...result.values()].sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date) || a.plan_id - b.plan_id);
}

function attachCandidates(occurrences, transactions) {
  const used = new Set(occurrences.filter(item => item.transaction_id).map(item => Number(item.transaction_id)));
  const groups = new Map();
  const matchKey = item => [item.transaction_date || item.occurrence_date, item.type, item.amount, item.category_id].join('|');
  for (const item of transactions) if (!used.has(Number(item.id)) && (item.entry_kind || 'standard') === 'standard') {
    const list = groups.get(matchKey(item)) || []; list.push(Number(item.id)); groups.set(matchKey(item), list);
  }
  return occurrences.map(item => ({ ...item, candidateTransactionIds: item.status === 'pending' && item.kind !== 'savings' ? groups.get(matchKey(item)) || [] : [] }));
}

const alertKey = (type, identity) => crypto.createHash('sha256').update(`${type}|${identity}`).digest('hex');
const signed = transaction => transaction.entry_kind === 'refund' ? Number(transaction.amount) : transaction.type === 'Income' ? Number(transaction.amount) : -Number(transaction.amount);

function forecastCashflow({ today, horizon, openingBalance, reservedAmount = 0, occurrences, transactions, fixedCategoryIds = [] }) {
  safe(openingBalance); safe(reservedAmount);
  if (![7,30,90].includes(horizon) || reservedAmount < 0) throw Object.assign(new Error('Invalid cashflow input'),{status:400,publicMessage:'Tahmin süresi veya ayrılan birikim tutarı geçersiz.'});
  const monthEnd = iso(new Date(Date.UTC(utc(today).getUTCFullYear(), utc(today).getUTCMonth() + 1, 0)));
  const projectionDays = Math.max(horizon, dayDiff(today, monthEnd) + 1);
  const end = addDays(today, horizon - 1);
  const projectionEnd = addDays(today, projectionDays - 1);
  const historyFrom = addDays(today, -90);
  const history = transactions.filter(item => item.transaction_date >= historyFrom && item.transaction_date < today);
  const fixed = new Set(fixedCategoryIds.map(Number));
  const linkedIds = new Set(occurrences.filter(item => item.transaction_id && (item.is_fixed || ['rent','bill','loan','credit_card','subscription'].includes(item.kind))).map(item => Number(item.transaction_id)));
  const expenses = history.filter(item => item.type === 'Expense' && !fixed.has(Number(item.category_id)) && !linkedIds.has(Number(item.id)));
  const recurring = new Set();
  const merchants = new Map();
  for (const item of expenses.filter(item => item.entry_kind !== 'refund')) {
    const merchant = String(item.merchant_name || item.description || '').trim().toLocaleLowerCase('tr-TR');
    if (!merchant) continue;
    const list = merchants.get(merchant) || []; list.push(item); merchants.set(merchant, list);
  }
  for (const list of merchants.values()) {
    list.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    if (list.length >= 3) {
      const last = list.slice(-3);
      const gaps = [dayDiff(last[0].transaction_date, last[1].transaction_date), dayDiff(last[1].transaction_date, last[2].transaction_date)];
      const amounts = last.map(item => Number(item.amount));
      if (gaps.every(gap => gap >= 26 && gap <= 35) && Math.max(...amounts) <= Math.min(...amounts) * 1.1) list.forEach(item => recurring.add(Number(item.id)));
    }
  }
  const variable = expenses.filter(item => !recurring.has(Number(item.id)));
  const activeWeeks = new Set(variable.filter(item => item.entry_kind !== 'refund').map(item => Math.floor(dayDiff(historyFrom, item.transaction_date) / 7))).size;
  const coverage = history.length && history.some(item => item.transaction_date <= addDays(today, -89));
  const enoughHistory = !!coverage && variable.filter(item => item.entry_kind !== 'refund').length >= 12 && activeWeeks >= 6 && recurring.size === 0;
  const variableTotal = Math.max(0, variable.reduce((sum, item) => safe(sum + (item.entry_kind === 'refund' ? -Number(item.amount) : Number(item.amount))), 0));
  const pending = occurrences.filter(item => item.status === 'pending' && item.occurrence_date <= projectionEnd);
  const uncertain = pending.some(item => item.candidateTransactionIds?.length && !(item.type === 'Income' && item.occurrence_date < today));
  const warnings = [];
  if (!enoughHistory) warnings.push('90 günlük yeterli ve düzenli harcama geçmişi yok veya takvime alınmamış düzenli giderler var. Geçmişe dayalı kesin bakiye tahmini üretilmedi.');
  if (recurring.size) warnings.push('Geçmişte aylık tekrarlayan ödemeler bulundu. Bunlar günlük ortalamaya katılmadı; gelecek ödemelerini takvime ekle.');
  if (uncertain) warnings.push('Planlanan ödemelerle eşleşebilecek kayıtlar var. Çift sayımı önlemek için bu işlemleri bağlayana kadar bakiye projeksiyonu durduruldu.');
  if (pending.some(item => item.type === 'Income' && item.occurrence_date < today)) warnings.push('Tarihi geçmiş ve gerçekleşmemiş gelirler bugün alınmış varsayılmadı. Beklenen yeni tarihi güncelle veya gerçekleşen işlemi bağla.');
  const availableNow = safe(openingBalance - reservedAmount);
  const deltas = new Map();
  for (const item of pending) {
    if (item.type === 'Income' && item.occurrence_date < today) continue;
    const date = item.occurrence_date < today ? today : item.occurrence_date;
    deltas.set(date, safe((deltas.get(date) || 0) + (item.type === 'Income' ? item.amount : -item.amount)));
  }
  for (const item of transactions) if (item.transaction_date > today && item.transaction_date <= projectionEnd) deltas.set(item.transaction_date, safe((deltas.get(item.transaction_date) || 0) + signed(item)));
  let known = availableNow;
  const variableCoverage = new Map();
  for (const item of pending) if (item.type === 'Expense' && item.kind !== 'savings' && !item.is_fixed && item.occurrence_date > today) variableCoverage.set(item.occurrence_date, safe((variableCoverage.get(item.occurrence_date) || 0) + item.amount));
  for (const item of transactions) if (item.type === 'Expense' && item.entry_kind !== 'refund' && !fixed.has(Number(item.category_id)) && item.transaction_date > today && item.transaction_date <= projectionEnd) variableCoverage.set(item.transaction_date, safe((variableCoverage.get(item.transaction_date) || 0) + Number(item.amount)));
  let coveredVariable = 0;
  const series = [];
  for (let index = 0; index < projectionDays; index++) {
    const date = addDays(today, index);
    const delta = deltas.get(date) || 0;
    known = safe(known + delta);
    coveredVariable = safe(coveredVariable + (variableCoverage.get(date) || 0));
    // Today's booked spending is already in openingBalance. Only future days
    // receive an estimate, and declared variable payments cover that baseline.
    const estimatedVariableExpense = enoughHistory ? Math.max(0, Number((BigInt(variableTotal) * BigInt(index) + 45n) / 90n) - coveredVariable) : null;
    series.push({ date, plannedDelta: delta, plannedBalance: uncertain ? null : known, estimatedVariableExpense, estimatedBalance: uncertain || estimatedVariableExpense === null ? null : safe(known - estimatedVariableExpense) });
  }
  const firstShortage = series.slice(0,horizon).find(item => (item.estimatedBalance ?? item.plannedBalance ?? 0) < 0) || null;
  const alerts = pending.filter(item => item.occurrence_date <= addDays(today, 6)).map(item => ({ fingerprint: alertKey('due', `${item.plan_id}|${item.occurrence_date}`), type: 'due', date: item.occurrence_date, title: `${item.title} · ${item.occurrence_date < today ? 'Gecikmiş plan' : 'Yaklaşan ödeme/gelir'}`, amount: item.amount }));
  if (firstShortage) alerts.push({ fingerprint: alertKey('shortage', firstShortage.date), type: 'shortage', date: firstShortage.date, title: 'Kullanılabilir bakiye eksiye düşebilir', amount: firstShortage.estimatedBalance ?? firstShortage.plannedBalance });
  const selectedPending = pending.filter(item => item.occurrence_date <= end);
  const futureBooked = transactions.filter(item => item.transaction_date > today && item.transaction_date <= end);
  const burden = safe(selectedPending.filter(item => item.type === 'Expense' && item.kind !== 'savings').reduce((sum, item) => safe(sum + item.amount), 0) + futureBooked.filter(item => item.type === 'Expense' && item.entry_kind !== 'refund').reduce((sum,item) => safe(sum+Number(item.amount)),0));
  const upcomingIncome = safe(selectedPending.filter(item => item.type === 'Income' && item.occurrence_date >= today).reduce((sum,item) => safe(sum+item.amount),0) + futureBooked.filter(item => item.type === 'Income').reduce((sum,item) => safe(sum+Number(item.amount)),0));
  if (burden > availableNow && !uncertain) alerts.push({ fingerprint: alertKey('burden', today), type: 'burden', date: today, title: 'Planlanan ödeme yükü mevcut kullanılabilir bakiyeyi aşıyor; beklenen gelirleri kontrol et.', amount: burden });
  alerts.sort((a,b)=>(a.type==='due'?1:0)-(b.type==='due'?1:0)||a.date.localeCompare(b.date));
  return { today, end, horizon, openingBalance, reservedAmount, availableNow, enoughHistory, confidence: enoughHistory ? 'limited' : 'insufficient', requiresReconciliation: uncertain, warnings, paymentBurden: uncertain ? null : burden, savingsAllocations: selectedPending.filter(item => item.kind === 'savings').reduce((sum, item) => safe(sum + item.amount), 0), upcomingIncome: uncertain ? null : upcomingIncome, endBalance: series[horizon-1], monthEnd: series.find(item => item.date === monthEnd) || null, firstShortage, series:series.slice(0,horizon), alerts };
}

module.exports = { addDays, dayDiff, occurrenceDate, isOccurrence, expandPlans, attachCandidates, forecastCashflow };
