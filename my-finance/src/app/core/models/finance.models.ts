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
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
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
  description: string;
  category_id: number;
  transaction_date: string;
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
