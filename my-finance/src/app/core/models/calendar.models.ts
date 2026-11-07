export type CalendarKind = 'salary' | 'rent' | 'bill' | 'loan' | 'credit_card' | 'subscription' | 'planned_income' | 'planned_expense' | 'savings';
export type CalendarFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface CalendarPlanInput {
  title: string;
  type: 'Income' | 'Expense';
  kind: CalendarKind;
  amount: number;
  category_id: number | null;
  frequency: CalendarFrequency;
  start_date: string;
  end_date: string | null;
  is_fixed: boolean;
}
export interface CalendarPlan extends CalendarPlanInput { id: number; }
export interface CalendarOccurrence {
  plan_id: number;
  occurrence_date: string;
  title: string;
  type: 'Income' | 'Expense';
  kind: CalendarKind;
  amount: number;
  category_id: number | null;
  status: 'pending' | 'linked' | 'reserved' | 'skipped';
  transaction_id: number | null;
  candidateTransactionIds: number[];
  linkedTransaction?: Pick<CalendarActual, 'id' | 'transaction_date' | 'description' | 'amount' | 'category'> | null;
}
export interface CalendarActual {
  id: number; type: 'Income' | 'Expense'; amount: number; description: string;
  transaction_date: string; category_id: number; category: string; entry_kind: 'standard' | 'refund';
}
export interface CalendarSnapshot { from: string; to: string; plans: CalendarPlan[]; occurrences: CalendarOccurrence[]; transactions: CalendarActual[]; }
export interface CashflowDay { date: string; plannedDelta: number; plannedBalance: number | null; estimatedVariableExpense: number | null; estimatedBalance: number | null; }
export interface CalendarAlert { fingerprint: string; type: 'due' | 'shortage' | 'burden'; date: string; title: string; amount: number; }
export interface CashflowProjection {
  today: string; end: string; horizon: number; openingBalance: number; reservedAmount: number; availableNow: number;
  enoughHistory: boolean; confidence: 'limited' | 'insufficient'; requiresReconciliation: boolean; warnings: string[];
  paymentBurden: number | null; savingsAllocations: number; upcomingIncome: number | null;
  endBalance: CashflowDay; monthEnd: CashflowDay | null; firstShortage: CashflowDay | null;
  series: CashflowDay[]; alerts: CalendarAlert[]; upcoming: CalendarOccurrence[];
}
