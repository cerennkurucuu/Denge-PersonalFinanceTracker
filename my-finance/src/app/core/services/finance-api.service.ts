import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ActiveFinancialPlan, AuthUser, Category, CategoryFormValue, DashboardSummary, ExchangeRate, ExchangeRateLog, FinancialAnalysis, MonthlyReport, PlanCategoryPreference, PlanScenarioPreview,
  Settings, Transaction, TransactionFormValue,
} from '../models/finance.models';

export interface ExchangeRatesBatchResult {
  quotes: Record<string, { quote: ExchangeRate | null; error?: string }>;
}

export interface StatementCheckResult {
  items: Array<{
    categoryId: number | null;
    categoryName: string | null;
    confidence: 'high' | 'medium' | 'low';
    matchedRule: string | null;
    merchant: string;
    fingerprint: string;
    duplicate: null | { kind: 'exact' | 'possible'; transactionId: number; description: string };
  }>;
}

@Injectable({ providedIn: 'root' })
export class FinanceApiService {
  private readonly http = inject(HttpClient);

  getGoogleConfig(): Observable<{ googleClientId: string | null }> {
    return this.http.get<{ googleClientId: string | null }>('/api/auth/config');
  }

  getCurrentUser(): Observable<{ user: AuthUser }> {
    return this.http.get<{ user: AuthUser }>('/api/auth/me');
  }

  signIn(credential: string): Observable<{ user?: AuthUser; mfaRequired?: boolean }> {
    return this.http.post<{ user?: AuthUser; mfaRequired?: boolean }>('/api/auth/google', { credential });
  }

  verifyMfa(code: string): Observable<{ user: AuthUser }> {
    return this.http.post<{ user: AuthUser }>('/api/auth/mfa/verify', { code });
  }

  touchSession():Observable<void> {
    return this.http.post<void>('/api/auth/activity',{});
  }

  getMfaStatus(): Observable<{ enabled: boolean }> {
    return this.http.get<{ enabled: boolean }>('/api/auth/mfa/status');
  }

  setupMfa(): Observable<{ secret: string; otpauthUri: string }> {
    return this.http.post<{ secret: string; otpauthUri: string }>('/api/auth/mfa/setup', {});
  }

  enableMfa(code: string): Observable<{ enabled: boolean; recoveryCodes:string[] }> {
    return this.http.post<{ enabled: boolean; recoveryCodes:string[] }>('/api/auth/mfa/enable', { code });
  }

  disableMfa(code: string): Observable<{ enabled: boolean }> {
    return this.http.post<{ enabled: boolean }>('/api/auth/mfa/disable', { code });
  }

  signOut(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }

  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>('/api/categories');
  }

  getTransactions(): Observable<Transaction[]> {
    return this.http.get<Transaction[]>('/api/transactions');
  }

  getExchangeCurrencies(): Observable<{ effectiveDate: string; currencies: string[] }> {
    return this.http.get<{ effectiveDate: string; currencies: string[] }>('/api/exchange-rates/currencies');
  }

  getExchangeRate(currency: string, date: string): Observable<ExchangeRate> {
    return this.http.get<ExchangeRate>(`/api/exchange-rates?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(date)}`);
  }

  getExchangeRatesBatch(items: Array<{ currency: string; date: string }>): Observable<ExchangeRatesBatchResult> {
    return this.http.post<ExchangeRatesBatchResult>('/api/exchange-rates/batch', { items });
  }

  checkStatement(items: Array<Record<string, unknown>>): Observable<StatementCheckResult> {
    return this.http.post<StatementCheckResult>('/api/statements/check', { items });
  }

  importStatement(body: { fileSha256: string; fileName: string; skippedCount: number; items: Array<Record<string, unknown>> }): Observable<{ result: { imported: number; duplicates: number; skipped: number; potentialDuplicates: number; invalid: number; batchId: number } }> {
    return this.http.post<{ result: { imported: number; duplicates: number; skipped: number; potentialDuplicates: number; invalid: number; batchId: number } }>('/api/statements/import', body);
  }

  getImportHistory(): Observable<Array<{ id: number; file_name: string; source_count: number; imported_count: number; duplicate_count: number; skipped_count: number; created_at: string }>> {
    return this.http.get<Array<{ id: number; file_name: string; source_count: number; imported_count: number; duplicate_count: number; skipped_count: number; created_at: string }>>('/api/statements');
  }

  getPlanPreferences(): Observable<{ categories: PlanCategoryPreference[]; monthsUsed: number; currency: 'TRY' }> {
    return this.http.get<{ categories: PlanCategoryPreference[]; monthsUsed: number; currency: 'TRY' }>('/api/plans/preferences');
  }

  savePlanPreferences(categories: Array<{ categoryId: number; protectedAmount: number; reductionRate: number }>): Observable<{ saved: number }> {
    return this.http.put<{ saved: number }>('/api/plans/preferences', { categories });
  }

  getPlanScenarios(targetSavings: number): Observable<PlanScenarioPreview> {
    return this.http.get<PlanScenarioPreview>(`/api/plans/scenarios?targetSavings=${targetSavings}`);
  }

  createPlan(body: { name: string; targetSavings: number; scenarioId: 'relaxed' | 'balanced' | 'aggressive' }): Observable<{ id: number; scenario: unknown; calculation: unknown }> {
    return this.http.post<{ id: number; scenario: unknown; calculation: unknown }>('/api/plans', body);
  }

  getCurrentPlan(): Observable<{ plan: ActiveFinancialPlan | null }> {
    return this.http.get<{ plan: ActiveFinancialPlan | null }>('/api/plans/current');
  }

  getPlanHistory(): Observable<Array<{ id: number; name: string; start_date: string; end_date: string; target_savings: number; status: string }>> {
    return this.http.get<Array<{ id: number; name: string; start_date: string; end_date: string; target_savings: number; status: string }>>('/api/plans/history');
  }

  changePlanStatus(id: number, status: 'completed' | 'archived'): Observable<{ id: number; status: string }> {
    return this.http.patch<{ id: number; status: string }>(`/api/plans/${id}/status`, { status });
  }

  getFinancialAnalysis(from: string, to: string): Observable<FinancialAnalysis> {
    return this.http.get<FinancialAnalysis>(`/api/reports/analysis?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  recordRecommendationFeedback(fingerprint: string, action: 'accepted' | 'rejected' | 'dismissed'): Observable<{ fingerprint: string; action: string }> {
    return this.http.post<{ fingerprint: string; action: string }>(`/api/reports/recommendations/${fingerprint}/feedback`, { action });
  }

  getRateHistory(id: number): Observable<ExchangeRateLog[]> {
    return this.http.get<ExchangeRateLog[]>(`/api/transactions/${id}/rate-history`);
  }

  getDashboardSummary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>('/api/dashboard/summary');
  }

  getMonthlyReport(year: number): Observable<MonthlyReport[]> {
    return this.http.get<MonthlyReport[]>(`/api/reports/monthly?year=${year}`);
  }

  getReportTotal(type: 'Income' | 'Expense', from: string, to: string): Observable<{ amount: number; issues: number }> {
    return this.http.get<{amount:number;issues:number}>('/api/reports/totals', {params:{type,from,to}});
  }

  getSettings(): Observable<Settings> {
    return this.http.get<Settings>('/api/settings');
  }

  saveTransaction(value: TransactionFormValue, id: number | null): Observable<Transaction> {
    const body = { ...value };
    return id
      ? this.http.put<Transaction>(`/api/transactions/${id}`, body)
      : this.http.post<Transaction>('/api/transactions', body);
  }

  deleteTransaction(id: number): Observable<void> {
    return this.http.delete<void>(`/api/transactions/${id}`);
  }

  deleteTransactions(ids: number[]): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>('/api/transactions', { body: { ids } });
  }

  saveCategory(value: CategoryFormValue): Observable<Category> {
    const body = { name: value.name, type: value.type, color: value.color, icon: value.icon };
    return value.id
      ? this.http.put<Category>(`/api/categories/${value.id}`, body)
      : this.http.post<Category>('/api/categories', body);
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`/api/categories/${id}`);
  }

  setPreferredCategory(id: number): Observable<Category> {
    return this.http.put<Category>(`/api/categories/${id}/preferred`, {});
  }

  updateSettings(settings: Partial<Settings>): Observable<Settings> {
    return this.http.put<Settings>('/api/settings', settings);
  }
}
