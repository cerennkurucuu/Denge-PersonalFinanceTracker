import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { CalendarPlan, CalendarPlanInput, CalendarSnapshot, CashflowProjection } from '../models/calendar.models';

@Injectable({ providedIn: 'root' })
export class CalendarApiService {
  private readonly http = inject(HttpClient);
  getCalendar(from: string, to: string) { return this.http.get<CalendarSnapshot>('/api/calendar', { params: { from, to } }); }
  getCashflow(days: number) { return this.http.get<CashflowProjection>('/api/cashflow', { params: { days } }); }
  savePlan(plan: CalendarPlanInput, id: number | null) {
    return id ? this.http.put<CalendarPlan>(`/api/calendar/plans/${id}`, plan) : this.http.post<CalendarPlan>('/api/calendar/plans', plan);
  }
  archivePlan(id: number) { return this.http.delete<void>(`/api/calendar/plans/${id}`); }
  updatePlans(ids: number[], changes: { category_id?: number; is_fixed?: boolean }) {
    return this.http.patch<{ updated: number }>('/api/calendar/plans/bulk', { ids, ...changes });
  }
  markOccurrence(id: number, date: string, action: 'link' | 'reserve' | 'skip', transactionId?: number) {
    return this.http.post<{ message: string }>(`/api/calendar/plans/${id}/occurrences/${date}`, { action, transactionId });
  }
  undoOccurrence(id: number, date: string) { return this.http.delete<void>(`/api/calendar/plans/${id}/occurrences/${date}`); }
  dismissAlert(fingerprint: string) { return this.http.post<void>(`/api/calendar/alerts/${fingerprint}/dismiss`, {}); }
}
