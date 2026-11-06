export type TransactionType = 'Income' | 'Expense';
export type FinancePage = 'dashboard' | 'transactions' | 'reports' | 'categories';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

export interface Category {
  id: number;
  name: string;
  type: TransactionType;
  color: string;
  icon: string;
  is_default: number;
  is_preferred: number;
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  original_amount: number;
  currency_code: string;
  exchange_rate: number;
  tcmb_rate: number | null;
  rate_source: 'TRY' | 'TCMB' | 'manual';
  rate_effective_date: string | null;
  description: string;
  category_id: number;
  category: string;
  category_color: string;
  transaction_date: string;
  entry_kind?: 'standard' | 'refund';
  merchant_name?: string | null;
}

export interface DashboardCategory {
  name: string;
  color: string;
  amount: number;
}

export interface DashboardSummary {
  balance: number;
  income: number;
  expense: number;
  monthIncome: number;
  monthExpense: number;
  previousMonthIncome: number;
  previousMonthExpense: number;
  recent: Transaction[];
  categories: DashboardCategory[];
}

export interface MonthlyReport {
  month: string;
  income: number;
  expense: number;
}

export interface Settings {
  currency: string;
  theme: 'light' | 'dark';
  language: string;
}

export interface TransactionFormValue {
  type: TransactionType;
  amount: string | number;
  original_amount?: number;
  currency_code: string;
  exchange_rate: string | number;
  tcmb_rate: string | number | null;
  rate_source: 'TRY' | 'TCMB' | 'manual';
  rate_effective_date: string | null;
  description: string;
  category_id: number;
  transaction_date: string;
}

export interface ExchangeRate {
  currency: string;
  rate: number;
  unit: number;
  effectiveDate: string;
  source: 'TCMB';
  basis: string;
}

export interface PlanCategoryPreference {
  categoryId: number;
  name: string;
  monthlyAverage: number;
  protectedAmount: number;
  reductionRate: number;
  configured: boolean;
}

export interface PlanScenario {
  id: 'relaxed' | 'balanced' | 'aggressive';
  label: string;
  requestedImprovement: number;
  attainableImprovement: number;
  attainable: boolean;
  plannedExpense: number;
  netAfterPlan: number;
  monthlySavings: number;
  remainingDeficit: number;
  categoryTargets: Array<{ category: string; categoryId?: number; monthlyLimit: number; monthlyReduction: number }>;
}

export interface ActiveFinancialPlan {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  target_savings: number;
  requested_improvement: number;
  planned_improvement: number;
  status: 'active' | 'completed' | 'archived';
  input_snapshot: { monthlyIncome?: number; monthlyExpense?: number; feasible?: boolean; confidence?: 'low' | 'medium' };
  category_targets: Array<{ categoryId: number; category: string; monthlyLimit: number; monthlyReduction: number; spent: number; remaining: number; weeklyBudget: number; exceeded: boolean; progressPercent: number }>;
}

export interface PlanScenarioPreview {
  inputs: { monthlyIncome: number; monthlyExpense: number; targetSavings: number; currentNet: number; currentDeficit: number; requiredImprovement: number; totalReductionCapacity: number; feasible: boolean; confidence: 'low' | 'medium'; monthsUsed: number };
  scenarios: PlanScenario[];
}

export interface FinancialAnalysis {
  from: string;
  to: string;
  summary: { income: number; expense: number; net: number; savingsRate: number | null };
  currentMonth: { income: number; expense: number; net: number; savingsRate: number | null };
  previousMonth: string;
  currentMonthKey: string;
  monthlyTrend: Array<{ month: string; income: number; expense: number }>;
  categories: Array<{ name: string; amount: number }>;
  topMerchants: Array<{ merchant: string; count: number; amount: number }>;
  fixedAndVariable: { repeatedMerchantExpense: number; otherExpense: number; explanation: string };
  payrollAfterSpend: { observations: number; medianSevenDayExpense: number; confidence: 'low' | 'medium' } | null;
  habits: {
    historyDays: number; confidence: 'low' | 'medium'; hasEnoughHistory: boolean;
    windowTotals: Record<number, { income: number; expense: number }>;
    repeatedMerchants: Array<{ merchant: string; count: number; amount: number; previous30DayCount: number }>;
    categoryChanges: Array<{ category: string; current30Days: number; prior90DayMonthlyAverage: number; changeRate: number }>;
    weekendVsWeekday: { weekend: number; weekday: number; days: number };
    possibleSubscriptions: Array<{ merchant: string; count: number; amount: number; note: string }>;
    forecast: null | { income: number; expense: number; basisMonths: string[]; confidence: 'low'; explanation: string };
    periodChanges: Array<{
      months: 3 | 6;
      currentIncome: number;
      priorIncome: number;
      currentExpense: number;
      priorExpense: number;
      incomeChangeRate: number | null;
      expenseChangeRate: number | null;
      sufficientHistory: boolean;
      currentMonths: string[];
      comparisonMonths: string[];
    }>;
  };
  recommendations: Array<{ kind: string; fingerprint: string; explanation: string; expectedImpact: number | null; impactBasis: string; confidence: 'low' | 'medium'; feedback: 'accepted' | 'rejected' | 'dismissed' | null }>;
  financialStatus: { recurringDeficitMonths: number; historyMonths: number };
}

export interface ExchangeRateLog {
  id: number;
  currency_code: string;
  original_amount: number;
  try_amount: number;
  applied_rate: number;
  tcmb_rate: number | null;
  rate_source: 'TRY' | 'TCMB' | 'manual';
  rate_effective_date: string | null;
  created_at: string;
}

export interface CategoryFormValue {
  id: number;
  name: string;
  type: TransactionType;
  color: string;
  icon: string;
}

export interface DeletePrompt {
  kind: 'transaction' | 'category';
  id: number;
  label: string;
}
