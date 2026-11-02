import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { ExchangeRate } from '../../../core/models/finance.models';
import { FinanceApiService } from '../../../core/services/finance-api.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';

interface RateRow {
  currency: 'EUR' | 'USD' | 'GBP';
  quote: ExchangeRate | null;
}

@Component({
  selector: 'app-exchange-rates-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './exchange-rates-widget.component.html',
  styleUrl: './exchange-rates-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExchangeRatesWidgetComponent implements OnInit, OnDestroy {
  private readonly api = inject(FinanceApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly format = inject(FinanceFormatService);
  readonly rows: RateRow[] = [
    { currency: 'EUR', quote: null },
    { currency: 'USD', quote: null },
    { currency: 'GBP', quote: null },
  ];
  loading = true;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.refresh();
    this.scheduleNextPublicationRefresh();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  formatRate(value: number): string {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
  }

  refresh(): void {
    this.loading = true;
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    const date = this.format.localDate(nextDay);
    forkJoin(this.rows.map(row => this.api.getExchangeRate(row.currency, date).pipe(catchError(() => of(null))))).subscribe(quotes => {
      quotes.forEach((quote, index) => this.rows[index].quote = quote);
      this.loading = false;
      this.changeDetector.markForCheck();
    });
  }

  private scheduleNextPublicationRefresh(): void {
    const now = new Date();
    const localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).reduce<Record<string, string>>((parts, item) => {
      parts[item.type] = item.value;
      return parts;
    }, {});
    const year = Number(localTime['year']);
    const month = Number(localTime['month']);
    const day = Number(localTime['day']);
    const weekday = localTime['weekday'];
    const minutesNow = Number(localTime['hour']) * 60 + Number(localTime['minute']);
    let dayOffset = 0;
    if ((weekday === 'Sat' || weekday === 'Sun') || minutesNow >= (15 * 60 + 40)) dayOffset = 1;

    while (true) {
      const candidate = new Date(Date.UTC(year, month - 1, day + dayOffset));
      const candidateWeekday = candidate.getUTCDay();
      if (candidateWeekday !== 0 && candidateWeekday !== 6) break;
      dayOffset += 1;
    }

    const targetLocalAsUtc = Date.UTC(year, month - 1, day + dayOffset, 15, 40);
    const offsetProbe = new Date(targetLocalAsUtc);
    const targetParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(offsetProbe).reduce<Record<string, string>>((parts, item) => {
      parts[item.type] = item.value;
      return parts;
    }, {});
    const targetAsUtcInZone = Date.UTC(
      Number(targetParts['year']), Number(targetParts['month']) - 1, Number(targetParts['day']),
      Number(targetParts['hour']), Number(targetParts['minute']), Number(targetParts['second']),
    );
    const zoneOffset = targetAsUtcInZone - targetLocalAsUtc;
    const delay = Math.max(1_000, targetLocalAsUtc - zoneOffset - now.getTime());
    this.refreshTimer = setTimeout(() => {
      this.refresh();
      this.scheduleNextPublicationRefresh();
    }, delay);
  }
}
