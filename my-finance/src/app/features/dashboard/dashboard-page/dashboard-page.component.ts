import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject } from '@angular/core';
import { AuthUser, FinancePage } from '../../../core/models/finance.models';
import { FinanceChartService } from '../../../core/services/finance-chart.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent implements AfterViewChecked, OnDestroy {
  readonly finance = inject(FinanceStoreService);
  readonly format = inject(FinanceFormatService);
  private readonly charts = inject(FinanceChartService);
  @Input({ required: true }) user!: AuthUser;
  @Output() pageChange = new EventEmitter<FinancePage>();
  @ViewChild('flowChart') private flowCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('categoryChart') private categoryCanvas?: ElementRef<HTMLCanvasElement>;

  get fullName(): string {
    return this.user?.name.trim() || 'Denge kullanıcısı';
  }

  ngAfterViewChecked(): void {
    this.charts.syncMonthly('flow', this.flowCanvas?.nativeElement, this.finance.monthly, this.format);
    this.charts.syncCategories(this.categoryCanvas?.nativeElement, this.finance.summary.categories, this.format);
  }

  ngOnDestroy(): void {
    this.charts.destroy('flow');
    this.charts.destroy('category');
  }

  openNewTransaction(): void { this.finance.openNewTransaction(); }
  editTransaction(item: Parameters<FinanceStoreService['editTransaction']>[0]): void { this.finance.editTransaction(item); }
  goTo(page: FinancePage): void { this.pageChange.emit(page); }
}
