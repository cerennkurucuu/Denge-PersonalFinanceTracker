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
