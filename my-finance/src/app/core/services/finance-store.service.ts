import { Injectable, inject } from '@angular/core';
import { Category, CategoryFormValue, DashboardSummary, DeletePrompt, MonthlyReport, Transaction, TransactionFormValue, TransactionType } from '../models/finance.models';
import { FinanceApiService } from './finance-api.service';
import { FinanceFormatService } from './finance-format.service';

const emptySummary: DashboardSummary = {
  balance: 0, income: 0, expense: 0, monthIncome: 0, monthExpense: 0,
  previousMonthIncome: 0, previousMonthExpense: 0, recent: [], categories: [],
};

@Injectable({ providedIn: 'root' })
export class FinanceStoreService {
  private readonly api = inject(FinanceApiService);
  private readonly format = inject(FinanceFormatService);

  summary: DashboardSummary = { ...emptySummary };
  transactions: Transaction[] = [];
  categories: Category[] = [];
  monthly: MonthlyReport[] = [];
  loading = true;
  error = '';
  notice = '';
  modalError = '';
  dark = false;
  transactionModal = false;
  categoryModal = false;
  editingTransactionId: number | null = null;
  transactionFilter: 'All' | TransactionType = 'All';
  transactionFrom = '';
  transactionTo = '';
  reportYear = new Date().getFullYear();
  reportFrom = `${this.reportYear}-01-01`;
  reportTo = `${this.reportYear}-12-31`;
  deletePrompt: DeletePrompt | null = null;
  transactionForm: TransactionFormValue = this.emptyTransactionForm();
  categoryForm: CategoryFormValue = this.emptyCategoryForm();

  readonly currentDate = this.format.localDate(new Date());

  get visibleTransactions(): Transaction[] {
    if (this.hasInvalidTransactionRange) return [];
    return this.transactions.filter(item =>
      (this.transactionFilter === 'All' || item.type === this.transactionFilter)
      && (!this.transactionFrom || item.transaction_date.slice(0, 10) >= this.transactionFrom)
      && (!this.transactionTo || item.transaction_date.slice(0, 10) <= this.transactionTo),
    );
  }

  get hasInvalidTransactionRange(): boolean {
    return !!this.transactionFrom && !!this.transactionTo && this.transactionFrom > this.transactionTo;
  }

  get reportDateRangeValid(): boolean {
    return !!this.reportFrom && !!this.reportTo && this.reportFrom <= this.reportTo;
  }

  get reportTransactions(): Transaction[] {
    if (!this.reportDateRangeValid) return [];
    return this.transactions.filter(item => {
      const date = item.transaction_date.slice(0, 10);
      return date >= this.reportFrom && date <= this.reportTo;
    });
  }

  get reportIncome(): number {
    return this.reportTransactions.reduce((sum, item) => sum + (item.type === 'Income' ? item.amount : 0), 0);
  }

  get reportExpense(): number {
    return this.reportTransactions.reduce((sum, item) => sum + (item.type === 'Expense' ? item.amount : 0), 0);
  }

  get reportSavings(): number {
    return this.reportIncome - this.reportExpense;
  }

  get reportCategories(): DashboardSummary['categories'] {
    const totals = new Map<string, DashboardSummary['categories'][number]>();
    for (const transaction of this.reportTransactions) {
      if (transaction.type !== 'Expense') continue;
      const current = totals.get(transaction.category) ?? { name: transaction.category, color: transaction.category_color, amount: 0 };
      current.amount += transaction.amount;
      totals.set(transaction.category, current);
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  }

  get availableCategories(): Category[] {
    return this.categories
      .filter(category => category.type === this.transactionForm.type)
      .sort((a, b) => b.is_preferred - a.is_preferred);
  }

  preferredCategory(type: TransactionType): Category | undefined {
    return this.categories.find(category => category.type === type && category.is_preferred === 1);
  }

  get expenseCategories(): Category[] {
    return this.categories.filter(category => category.type === 'Expense');
  }

  get incomeCategories(): Category[] {
    return this.categories.filter(category => category.type === 'Income');
  }

  get monthSavings(): number {
    return this.summary.monthIncome - this.summary.monthExpense;
  }

  get yearIncome(): number {
    return this.monthly.reduce((total, item) => total + item.income, 0);
  }

  get yearExpense(): number {
    return this.monthly.reduce((total, item) => total + item.expense, 0);
  }

  get yearSavings(): number {
    return this.yearIncome - this.yearExpense;
  }

  setReportYear(year: number): void {
    this.reportYear = year;
    this.reportFrom = `${year}-01-01`;
    this.reportTo = `${year}-12-31`;
    this.loadMonthly();
  }

  clearTransactionFilters(): void {
    this.transactionFilter = 'All';
    this.transactionFrom = '';
    this.transactionTo = '';
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getCategories().subscribe({
      next: categories => {
        this.categories = categories;
        if (this.transactionModal && this.editingTransactionId === null) {
          this.transactionForm.category_id = this.preferredCategory(this.transactionForm.type)?.id ?? 0;
        }
      },
      error: () => this.error = 'Kategoriler yüklenemedi. API sunucusunun çalıştığından emin olun.',
    });
    this.api.getTransactions().subscribe({
      next: transactions => { this.transactions = transactions; this.loading = false; },
      error: () => { this.loading = false; this.error = 'Veriler yüklenemedi. API sunucusunun çalıştığından emin olun.'; },
    });
    this.api.getDashboardSummary().subscribe({
      next: summary => this.summary = summary,
      error: () => this.error = 'Özet bilgisi alınamadı.',
    });
    this.loadMonthly();
    this.api.getSettings().subscribe({
      next: settings => { this.dark = settings.theme === 'dark'; this.applyTheme(); },
    });
  }

  clear(): void {
    this.summary = { ...emptySummary };
    this.transactions = [];
    this.categories = [];
    this.monthly = [];
    this.loading = true;
    this.error = '';
    this.notice = '';
    this.modalError = '';
    this.transactionModal = false;
    this.categoryModal = false;
    this.deletePrompt = null;
  }

  loadMonthly(): void {
    this.api.getMonthlyReport(this.reportYear).subscribe({
      next: report => this.monthly = report,
      error: () => this.error = 'Aylık rapor yüklenemedi.',
    });
  }

  openNewTransaction(type: TransactionType = 'Expense'): void {
    this.editingTransactionId = null;
    this.modalError = '';
    this.transactionForm = { ...this.emptyTransactionForm(), type, category_id: this.preferredCategory(type)?.id ?? 0 };
    this.transactionModal = true;
  }

  setTransactionType(type: TransactionType): void {
    this.transactionForm.type = type;
    this.transactionForm.category_id = this.preferredCategory(type)?.id ?? 0;
  }

  editTransaction(item: Transaction): void {
    this.editingTransactionId = item.id;
    this.modalError = '';
    this.transactionForm = {
      type: item.type,
      amount: (item.amount / 100).toFixed(2),
      description: item.description,
      category_id: item.category_id,
      transaction_date: item.transaction_date.slice(0, 10),
    };
    this.transactionModal = true;
  }

  saveTransaction(): void {
    this.modalError = '';
    const amount = this.format.toCents(this.transactionForm.amount);
    if (!this.transactionForm.description.trim() || !this.transactionForm.category_id || amount === null || amount <= 0 || !this.transactionForm.transaction_date) {
      this.modalError = 'Açıklama, kategori, geçerli tarih ve sıfırdan büyük (en fazla iki ondalık basamaklı) tutar girin.';
      return;
    }
    const editing = this.editingTransactionId !== null;
    this.api.saveTransaction({ ...this.transactionForm, amount }, this.editingTransactionId).subscribe({
      next: () => {
        this.transactionModal = false;
        this.modalError = '';
        this.error = '';
        this.notice = editing ? 'İşlem güncellendi.' : 'İşlem eklendi.';
        this.load();
      },
      error: response => this.modalError = response.error?.error || 'İşlem kaydedilemedi.',
    });
  }

  requestTransactionDelete(item: Transaction): void {
    this.deletePrompt = { kind: 'transaction', id: item.id, label: item.description };
  }

  requestCategoryDelete(category: Category): void {
    if (category.is_default) return;
    this.deletePrompt = { kind: 'category', id: category.id, label: category.name };
  }

  cancelDelete(): void {
    this.deletePrompt = null;
  }

  confirmDelete(): void {
    const pending = this.deletePrompt;
    if (!pending) return;
    const deletion = pending.kind === 'transaction'
      ? this.api.deleteTransaction(pending.id)
      : this.api.deleteCategory(pending.id);
    deletion.subscribe({
      next: () => {
        this.deletePrompt = null;
        this.error = '';
        this.notice = pending.kind === 'transaction' ? 'İşlem silindi.' : 'Kategori silindi.';
        this.load();
      },
      error: response => {
        this.deletePrompt = null;
        this.error = response.error?.error || (pending.kind === 'transaction' ? 'İşlem silinemedi.' : 'Kategori silinemedi.');
      },
    });
  }

  openNewCategory(): void {
    this.categoryForm = this.emptyCategoryForm();
    this.modalError = '';
    this.categoryModal = true;
  }

  editCategory(category: Category): void {
    if (category.is_default) return;
    this.modalError = '';
    this.categoryForm = { id: category.id, name: category.name, type: category.type, color: category.color, icon: category.icon };
    this.categoryModal = true;
  }

  saveCategory(): void {
    this.modalError = '';
    const value = { ...this.categoryForm, name: this.categoryForm.name.trim() };
    if (!value.name) {
      this.modalError = 'Kategori adı gerekli.';
      return;
    }
    this.api.saveCategory(value).subscribe({
      next: () => {
        this.categoryModal = false;
        this.modalError = '';
        this.load();
        this.notice = 'Kategori kaydedildi.';
      },
      error: response => this.modalError = response.error?.error || 'Kategori kaydedilemedi.',
    });
  }

  setPreferredCategory(category: Category): void {
    this.api.setPreferredCategory(category.id).subscribe({
      next: selected => {
        this.categories = this.categories.map(current => current.type === selected.type
          ? { ...current, is_preferred: current.id === selected.id ? 1 : 0 }
          : current);
        this.notice = `${selected.name}, ${selected.type === 'Income' ? 'gelir' : 'gider'} işlemleri için varsayılan kategori oldu.`;
      },
      error: response => this.error = response.error?.error || 'Varsayılan kategori kaydedilemedi.',
    });
  }

  toggleTheme(): void {
    this.dark = !this.dark;
    this.applyTheme();
    this.api.updateSettings({ theme: this.dark ? 'dark' : 'light' }).subscribe();
  }

  exportCsv(): void {
    const rows = [
      ['Tarih', 'Tür', 'Açıklama', 'Kategori', 'Tutar (TRY)'],
      ...this.visibleTransactions.map(item => [
        this.format.formatDate(item.transaction_date),
        item.type === 'Income' ? 'Gelir' : 'Gider',
        item.description,
        item.category,
        (item.amount / 100).toFixed(2),
      ]),
    ];
    this.downloadCsv(rows, `denge-islemler_${this.transactionFrom || 'tum'}_${this.transactionTo || 'tum'}.csv`);
  }

  exportReportCsv(): void {
    if (!this.reportDateRangeValid) return;
    const rows: Array<Array<string | number>> = [
      ['Denge - Finansal rapor'],
      ['Rapor dönemi', `${this.reportFrom} - ${this.reportTo}`],
      ['Gelir (TRY)', (this.reportIncome / 100).toFixed(2)],
      ['Gider (TRY)', (this.reportExpense / 100).toFixed(2)],
      ['Net birikim (TRY)', (this.reportSavings / 100).toFixed(2)],
      [],
      ['Kategori analizi'],
      ['Kategori', 'Tutar (TRY)'],
      ...this.reportCategories.map(category => [category.name, (category.amount / 100).toFixed(2)]),
      [],
      ['İşlem listesi'],
      ['Tarih', 'Tür', 'Açıklama', 'Kategori', 'Tutar (TRY)'],
      ...this.reportTransactions.map(item => [
        this.format.formatDate(item.transaction_date),
        item.type === 'Income' ? 'Gelir' : 'Gider',
        item.description,
        item.category,
        (item.amount / 100).toFixed(2),
      ]),
    ];
    this.downloadCsv(rows, `denge-rapor_${this.reportFrom}_${this.reportTo}.csv`);
  }

  private downloadCsv(rows: Array<Array<string | number>>, filename: string): void {
    const csv = '\uFEFF' + rows.map(row => row.map(cell => {
      const value = String(cell);
      const safeValue = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replaceAll('"', '""')}"`;
    }).join(';')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  dismissError(): void { this.error = ''; }
  dismissNotice(): void { this.notice = ''; }

  private applyTheme(): void {
    document.documentElement.dataset['theme'] = this.dark ? 'dark' : 'light';
  }

  private emptyTransactionForm(): TransactionFormValue {
    return { type: 'Expense', amount: '', description: '', category_id: 0, transaction_date: this.format.localDate(new Date()) };
  }

  private emptyCategoryForm(): CategoryFormValue {
    return { id: 0, name: '', type: 'Expense', color: '#7c6cf2', icon: 'circle' };
  }
}
