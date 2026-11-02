import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AuthUser, Category, CategoryFormValue, DashboardSummary, ExchangeRate, ExchangeRateLog, MonthlyReport,
  Settings, Transaction, TransactionFormValue,
} from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class FinanceApiService {
  private readonly http = inject(HttpClient);

  getGoogleConfig(): Observable<{ googleClientId: string | null }> {
    return this.http.get<{ googleClientId: string | null }>('/api/auth/config');
  }

  getCurrentUser(): Observable<{ user: AuthUser }> {
    return this.http.get<{ user: AuthUser }>('/api/auth/me');
  }

  signIn(credential: string): Observable<{ user: AuthUser }> {
    return this.http.post<{ user: AuthUser }>('/api/auth/google', { credential });
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

  getRateHistory(id: number): Observable<ExchangeRateLog[]> {
    return this.http.get<ExchangeRateLog[]>(`/api/transactions/${id}/rate-history`);
  }

  getDashboardSummary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>('/api/dashboard/summary');
  }

  getMonthlyReport(year: number): Observable<MonthlyReport[]> {
    return this.http.get<MonthlyReport[]>(`/api/reports/monthly?year=${year}`);
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
