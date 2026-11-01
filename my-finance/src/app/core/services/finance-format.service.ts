import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FinanceFormatService {
  readonly money = new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY', maximumFractionDigits: 2,
  });

  readonly months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  readonly currentDateForToday = this.localDate(new Date());

  localDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  formatAmount(cents: number): string {
    return this.money.format(cents / 100);
  }

  formatDate(value: string): string {
    const [year, month, day] = value.slice(0, 10).split('-');
    return `${day}.${month}.${year}`;
  }

  toCents(value: string | number | null): number | null {
    if (value === null) return null;
    const normalized = String(value).trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const [whole, fraction = ''] = normalized.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
  }

  monthName(month: string): string {
    return this.months[Number(month) - 1] || '';
  }

  monthChange(current: number, previous: number): string {
    if (previous === 0) return current === 0 ? 'Değişim yok' : 'Geçen ay verisi yok';
    const percent = (current - previous) / previous * 100;
    return `${percent >= 0 ? '↗' : '↘'} ${Math.abs(percent).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}% geçen aya göre`;
  }
}
