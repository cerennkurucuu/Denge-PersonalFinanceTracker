import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActiveFinancialPlan, FinancialAnalysis, PlanCategoryPreference, PlanScenario, PlanScenarioPreview } from '../../../core/models/finance.models';
import { FinanceChartService } from '../../../core/services/finance-chart.service';
import { FinanceApiService } from '../../../core/services/finance-api.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './reports-page.component.scss',
})
export class ReportsPageComponent implements OnInit, AfterViewChecked, OnDestroy {
  readonly finance = inject(FinanceStoreService);
  readonly format = inject(FinanceFormatService);
  private readonly api = inject(FinanceApiService);
  private readonly charts = inject(FinanceChartService);
  readonly availableYears = Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - index);
  readonly today = this.format.currentDateForToday;
  analysis: FinancialAnalysis | null = null;
  analysisLoading = false;
  analysisError = '';
  selectedAnalysisCategory = '';
  analysisTab: 'overview' | 'habits' | 'plan' = 'overview';
  planTargetInput = '0,00';
  planError = '';
  planNotice = '';
  planLoading = false;
  savingPreferences = false;
  preferences: Array<PlanCategoryPreference & { protectedInput: string; reductionInput: string }> = [];
  scenarioPreview: PlanScenarioPreview | null = null;
  selectedScenarioId: PlanScenario['id'] | null = null;
  activePlan: ActiveFinancialPlan | null = null;
  planHistory: Array<{ id: number; name: string; start_date: string; end_date: string; target_savings: number; status: string }> = [];

  @ViewChild('reportChart') private chart?: ElementRef<HTMLCanvasElement>;

  ngOnInit(): void {
    if (this.finance.reportTo > this.today) this.finance.reportTo = this.today;
    this.loadAnalysis();
    this.loadPreferences();
    this.loadPlan();
    this.api.getPlanHistory().subscribe({ next: history => this.planHistory = history, error: () => this.planHistory = [] });
  }

  ngAfterViewChecked(): void {
    this.charts.syncMonthly('report', this.chart?.nativeElement, this.finance.monthly, this.format);
  }

  ngOnDestroy(): void {
    this.charts.destroy('report');
  }

  yearChanged(): void {
    this.finance.setReportYear(this.finance.reportYear);
    if (this.finance.reportTo > this.today) this.finance.reportTo = this.today;
    this.loadAnalysis();
  }

  dateRangeChanged(): void { this.loadAnalysis(); }

  get analysisCategories(): Array<{ name: string; amount: number }> {
    const categories = this.analysis?.categories || [];
    return this.selectedAnalysisCategory ? categories.filter(item => item.name === this.selectedAnalysisCategory) : categories;
  }

  get selectedScenario(): PlanScenario | undefined {
    return this.scenarioPreview?.scenarios.find(item => item.id === this.selectedScenarioId);
  }

  get priorMonth(): { month: string; income: number; expense: number } | undefined {
    return this.analysis?.monthlyTrend.find(item => item.month === this.analysis?.previousMonth);
  }

  categoryShare(amount: number): number {
    const highest = this.analysisCategories[0]?.amount ?? 0;
    return highest > 0 ? Math.round(amount / highest * 100) : 0;
  }

  trendWidth(value: number): number {
    const highest = Math.max(1, ...(this.analysis?.monthlyTrend || []).flatMap(item => [item.income, item.expense]));
    return Math.max(2, Math.round(value / highest * 100));
  }

  percent(value: number | null): string {
    return value === null ? 'Yeterli gelir verisi yok' : new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
  }

  loadAnalysis(): void {
    const from = this.finance.reportFrom;
    const to = this.finance.reportTo;
    if (!from || !to || from > to || to > this.today) { this.analysis = null; this.analysisError = 'Analiz için bugünü aşmayan geçerli bir tarih aralığı seç.'; return; }
    this.analysisLoading = true;
    this.analysisError = '';
    this.api.getFinancialAnalysis(from, to).subscribe({
      next: result => { this.analysis = result; this.analysisLoading = false; },
      error: response => { this.analysis = null; this.analysisError = response.error?.error || 'Finansal analiz alınamadı.'; this.analysisLoading = false; },
    });
  }

  private loadPreferences(): void {
    this.api.getPlanPreferences().subscribe({
      next: response => {
        this.preferences = response.categories.map(item => ({
          ...item,
          protectedInput: this.format.formatMinorUnits(item.protectedAmount, 'TRY'),
          reductionInput: String(item.reductionRate * 100),
        }));
        if (this.preferences.length) this.calculateScenarios();
      },
      error: response => this.planError = response.error?.error || 'Kategori plan ayarları alınamadı.',
    });
  }

  savePreferences(): void {
    this.planError = '';
    this.planNotice = '';
    const items = this.preferences.map(item => ({
      categoryId: item.categoryId,
      protectedAmount: this.format.toCents(item.protectedInput),
      reductionRate: Number(item.reductionInput) / 100,
    }));
    if (items.some(item => item.protectedAmount === null || item.protectedAmount > (this.preferences.find(preference => preference.categoryId === item.categoryId)?.monthlyAverage ?? 0) || !Number.isFinite(item.reductionRate) || item.reductionRate < 0 || item.reductionRate > 80)) {
      this.planError = 'Korunacak tutar kategori ortalamasını aşamaz; azaltma oranı %0–80 arasında olmalı.';
      return;
    }
    this.savingPreferences = true;
    this.api.savePlanPreferences(items.map(item => ({ categoryId: item.categoryId, protectedAmount: item.protectedAmount as number, reductionRate: item.reductionRate }))).subscribe({
      next: () => { this.savingPreferences = false; this.planNotice = 'Kategori tercihlerin kaydedildi.'; this.loadPreferences(); },
      error: response => { this.savingPreferences = false; this.planError = response.error?.error || 'Kategori plan tercihleri kaydedilemedi.'; },
    });
  }

  calculateScenarios(): void {
    const targetSavings = this.format.toCents(this.planTargetInput);
    if (targetSavings === null) { this.planError = 'Aylık birikim hedefi TL biçiminde geçerli olmalı.'; return; }
    this.planLoading = true;
    this.planError = '';
    this.api.getPlanScenarios(targetSavings).subscribe({
      next: preview => { this.scenarioPreview = preview; this.planLoading = false; this.selectedScenarioId = preview.scenarios[1]?.id ?? preview.scenarios[0]?.id ?? null; },
      error: response => { this.scenarioPreview = null; this.planLoading = false; this.planError = response.error?.error || 'Plan senaryoları hesaplanamadı.'; },
    });
  }

  createPlan(): void {
    const targetSavings = this.format.toCents(this.planTargetInput);
    if (targetSavings === null || !this.selectedScenarioId) return;
    this.planError = '';
    this.api.createPlan({ name: `${this.selectedScenario?.label || 'Kişisel'} plan`, targetSavings, scenarioId: this.selectedScenarioId }).subscribe({
      next: () => { this.planNotice = 'Yeni plan kaydedildi. Önceki plan ve ilerleme geçmişi korunuyor.'; this.loadPlan(); this.api.getPlanHistory().subscribe(history => this.planHistory = history); },
      error: response => this.planError = response.error?.error || 'Plan kaydedilemedi.',
    });
  }

  private loadPlan(): void {
    this.api.getCurrentPlan().subscribe({ next: response => this.activePlan = response.plan, error: () => this.activePlan = null });
  }

  updatePlanStatus(status: 'completed' | 'archived'): void {
    if (!this.activePlan) return;
    this.api.changePlanStatus(this.activePlan.id, status).subscribe({
      next: () => { this.activePlan = null; this.planNotice = status === 'completed' ? 'Plan tamamlandı olarak arşivlendi.' : 'Plan arşivlendi.'; this.api.getPlanHistory().subscribe(history => this.planHistory = history); },
      error: response => this.planError = response.error?.error || 'Plan durumu güncellenemedi.',
    });
  }

  recommendationFeedback(fingerprint: string, action: 'accepted' | 'rejected'): void {
    this.api.recordRecommendationFeedback(fingerprint, action).subscribe({
      next: () => {
        if (this.analysis) this.analysis.recommendations = this.analysis.recommendations.map(item => item.fingerprint === fingerprint ? { ...item, feedback: action } : item).filter(item => item.feedback !== 'rejected');
      },
      error: () => this.analysisError = 'Öneri tercihin kaydedilemedi.',
    });
  }
}
