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

  formatCurrency(cents: number, currency: string): string {
    try {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(cents / (10 ** this.minorUnitDigits(currency)));
    } catch {
      return `${(cents / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${currency}`;
    }
  }

  convertMinor(amountMinor: number, rate: string | number): number | null {
    return this.convertCurrencyMinor(amountMinor, rate, 'TRY');
  }

  convertCurrencyMinor(amountMinor: number, rate: string | number, currency: string): number | null {
    const normalized = String(rate).trim();
    if (!/^\d+(?:\.\d{1,10})?$/.test(normalized)) return null;
    const [whole, fraction = ''] = normalized.split('.');
    const scale = 10n ** 10n;
    const scaledRate = BigInt(whole) * scale + BigInt(fraction.padEnd(10, '0'));
    const denominator = scale * 10n ** BigInt(this.minorUnitDigits(currency));
    const result = Number((BigInt(amountMinor) * scaledRate * 100n + denominator / 2n) / denominator);
    return Number.isSafeInteger(result) ? result : null;
  }

  toMinorUnits(value: string | number | null, currency: string): number | null {
    if (value === null) return null;
    const normalized = String(value).trim().replace(',', '.');
    const digits = this.minorUnitDigits(currency);
    const pattern = digits ? new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`) : /^\d+$/;
    if (!pattern.test(normalized)) return null;
    const [whole, fraction = ''] = normalized.split('.');
    const amount = Number(whole) * (10 ** digits) + Number(fraction.padEnd(digits, '0'));
    return Number.isSafeInteger(amount) ? amount : null;
  }

  formatMinorUnits(minorAmount: number, currency: string): string {
    return (minorAmount / (10 ** this.minorUnitDigits(currency))).toFixed(this.minorUnitDigits(currency));
  }

  formatRate(rate: number): string {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(rate);
  }

  minorUnitDigits(currency: string): number {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
    catch { return 2; }
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
