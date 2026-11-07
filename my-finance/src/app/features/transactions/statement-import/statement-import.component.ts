import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Category } from '../../../core/models/finance.models';
import { ExchangeRatesBatchResult, FinanceApiService, StatementCheckResult } from '../../../core/services/finance-api.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { ParsedStatement, ParsedStatementItem, StatementParserService } from './statement-parser.service';

@Component({
  selector: 'app-statement-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './statement-import.component.html',
  styleUrl: './statement-import.component.scss',
})
export class StatementImportComponent {
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly imported = new EventEmitter<void>();

  readonly finance = inject(FinanceStoreService);
  readonly format = inject(FinanceFormatService);
  private readonly api = inject(FinanceApiService);
  private readonly parser = inject(StatementParserService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly currencies = ['TRY', 'EUR', 'USD', 'GBP', 'CAD', 'CHF', 'JPY', 'KWD', 'AUD', 'AED', 'CNY'];

  page=0;
  readonly pageSize=50;
  get pageRows(): ParsedStatementItem[] { return this.statement?.rows.slice(this.page*this.pageSize,(this.page+1)*this.pageSize) || []; }
  get pageCount(): number { return Math.ceil((this.statement?.rows.length || 0)/this.pageSize); }
  statement: ParsedStatement | null = null;
  loading = false;
  loadingStep = '';
  dragActive = false;
  saving = false;
  error = '';
  rateWarning = '';
  duplicateWarning = '';
  notice = '';
  result: { imported: number; duplicates: number; skipped: number; potentialDuplicates: number; invalid: number } | null = null;
  bulkType: 'Income' | 'Expense' = 'Expense';
  bulkCategoryId: number | null = null;

  get categories(): Category[] { return this.finance.categories; }
  get bulkCategories(): Category[] { return this.categories.filter(category => category.type === this.bulkType); }
  get validRows(): ParsedStatementItem[] { return this.statement?.rows.filter(row => !row.excluded && this.isValid(row)) || []; }
  get reviewRows(): ParsedStatementItem[] { return this.statement?.rows.filter(row => !row.excluded && !this.isValid(row)) || []; }
  get selectedRows(): ParsedStatementItem[] {
    if (this.finance.allowDuplicateImports) return this.validRows;
    return this.validRows.filter(row => row.duplicateKind !== 'exact' && (row.duplicateKind !== 'possible' || row.confirmPotentialDuplicate));
  }
  get skippedRows(): number { return this.statement ? this.statement.rows.length - this.selectedRows.length : 0; }

  reviewReason(row: ParsedStatementItem): string {
    if (row.error) return row.error;
    if (!row.transaction_date) return 'Tarih okunamadı.';
    if (!row.description.trim()) return 'Açıklama boş.';
    if (!row.originalAmount || !Number.isSafeInteger(row.originalAmount)) return 'Tutar tanınamadı.';
    if (row.currency_code !== 'TRY' && (!row.amount || Number(row.exchange_rate) <= 0)) return 'Bu tarih ve para birimi için kur gerekli.';
    if (!row.category_id) return 'Bu işlem türü için kategori seçilmedi.';
    if (row.error) return row.error;
    if (row.needsReview) return 'İşlem türü veya ekstre alanları doğrulanamadı.';
    return 'Alanları kontrol et.';
  }

  goToReviewRow(row: ParsedStatementItem): void {
    this.page=Math.floor((this.statement?.rows.indexOf(row) || 0)/this.pageSize);
    this.changeDetector.detectChanges();
    document.getElementById(`statement-row-${row.sourceRow}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  dragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.loading) this.dragActive = true;
  }

  dragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.loading ? 'none' : 'copy';
    if (!this.loading) this.dragActive = true;
  }

  dragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const current = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !current.contains(next)) this.dragActive = false;
  }

  fileDropped(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragActive = false;
    if (this.loading) return;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length > 1) {
      this.error = 'Bir seferde yalnızca bir ekstre dosyası bırakabilirsin.';
      return;
    }
    void this.processFile(files[0]);
  }

  async fileChanged(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.processFile(file, input);
  }

  private async processFile(file: File, input?: HTMLInputElement): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.loadingStep = 'Dosya okunuyor…';
    this.statement = null;
    this.page=0;
    this.error = '';
    this.notice = '';
    this.result = null;
    this.rateWarning = '';
    this.duplicateWarning = '';
    try {
      this.statement = await this.parser.parse(file);
      this.changeDetector.detectChanges();
      this.loadingStep = 'Kur ve mükerrer kayıt kontrolü yapılıyor…';
      this.changeDetector.detectChanges();
      await this.loadRates();
      this.loadingStep = 'Kategori önerileri hazırlanıyor…';
      this.changeDetector.detectChanges();
      await this.checkDuplicatesAndCategories();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ekstre okunamadı.';
      this.finance.error = this.error;
      this.finance.notice = '';
      if (this.statement) {
        this.duplicateWarning ||= 'Otomatik kontroller tamamlanamadı. Önizleme korunuyor; satırları gözden geçirip eksik alanları tamamlayabilirsin.';
        this.statement.rows.forEach(row => {
          if (!row.excluded) {
            row.needsReview = true;
            row.error ||= 'Kontrol bekliyor. İşlem türünü ve kategoriyi seç.';
          }
        });
      }
    } finally {
      this.loading = false;
      this.loadingStep = '';
      if (input) input.value = '';
      this.changeDetector.detectChanges();
    }
  }

  private async loadRates(): Promise<void> {
    const rows = this.statement?.rows || [];
    for (const row of rows) {
      if (row.currency_code === 'TRY' && row.originalAmount > 0) {
        row.exchange_rate = 1;
        row.amount = row.originalAmount;
        row.rate_source = 'TRY';
        row.rate_effective_date = null;
      }
    }
    const keys = [...new Set(rows.filter(row => !row.excluded && row.currency_code !== 'TRY' && row.transaction_date && row.originalAmount > 0).map(row => `${row.currency_code}|${row.transaction_date}`))];
    const available = keys.slice(0, 300);
    const omitted = keys.length - available.length;
    if (omitted) this.rateWarning = `${omitted} farklı para birimi/tarih çifti sınır nedeniyle otomatik doğrulanamadı; bu satırlara kur girmelisin.`;
    if (!available.length) return;
    let response: ExchangeRatesBatchResult | null = null;
    try {
      response = await firstValueFrom(this.api.getExchangeRatesBatch(available.map(key => {
        const [currency, date] = key.split('|');
        return { currency, date };
      })));
    } catch {
      this.rateWarning = 'TCMB kur hizmetine şu anda ulaşılamıyor. Ekstre önizlemesi hazır; dövizli satırların kurunu tabloda elle girebilirsin.';
    }
    this.changeDetector.detectChanges();
    for (const row of rows) {
      if (row.currency_code === 'TRY' || !row.transaction_date || !row.originalAmount) continue;
      const quote = response?.quotes[`${row.currency_code}|${row.transaction_date}`]?.quote;
      if (!quote) {
        row.error = 'TCMB kuru alınamadı; elle gir veya satırı dışarıda bırak.';
        row.exchange_rate = '';
        row.amount = 0;
        row.rate_source = 'manual';
        row.rate_effective_date = row.transaction_date;
        this.rateWarning ||= 'Bazı döviz kurları alınamadı. Bu satırlar kur girilmeden kaydedilemez.';
        continue;
      }
      row.exchange_rate = quote.rate;
      row.tcmb_rate = quote.rate;
      row.rate_source = 'TCMB';
      row.rate_effective_date = quote.effectiveDate;
      row.amount = this.format.convertCurrencyMinor(row.originalAmount, quote.rate, row.currency_code) ?? 0;
      if (!row.amount) row.error = 'TL karşılığı güvenli biçimde hesaplanamadı.';
    }
  }

  private async checkDuplicatesAndCategories(): Promise<void> {
    if (!this.statement) return;
    const candidates = this.statement.rows.filter(row => !row.excluded && row.transaction_date && row.description && row.originalAmount > 0);
    if (!candidates.length) return;
    for (const row of candidates) {
      if (!row.category_id && row.category_name) {
        const tag = row.category_name.toLocaleLowerCase('tr-TR').trim();
        const category = this.categories.find(item => item.type === row.type && item.name.toLocaleLowerCase('tr-TR').trim() === tag);
        if (category) row.category_id = category.id;
      }
    }
    let result: StatementCheckResult | null = null;
    try {
      result = await firstValueFrom(this.api.checkStatement(candidates.map(row => ({
        transaction_date: row.transaction_date,
        description: row.description,
        merchant_name: row.merchant_name,
        reference: row.reference,
        original_amount: row.originalAmount,
        currency_code: row.currency_code,
        type: row.type,
      }))));
    } catch {
      this.duplicateWarning = 'Mükerrer ve kategori kontrolüne şu anda ulaşılamıyor. Satırlar önizlemede tutuldu; kaydetmeden önce bilgileri gözden geçir.';
      candidates.forEach(row => {
        row.needsReview = true;
        row.category_id ||= this.fallbackCategory(row.type)?.id ?? null;
        row.error ||= 'Kontrol bekliyor. Tarih, tutar, tür ve kategoriyi doğrula.';
      });
      this.changeDetector.detectChanges();
      return;
    }
    candidates.forEach((row, index) => {
      const match = result?.items[index];
      if (!match) return;
      if (!row.category_id && match.categoryId) {
        row.category_id = match.categoryId;
        row.category_name = match.categoryName;
      }
      row.merchant_name = match.merchant || row.merchant_name;
      if (match.duplicate) {
        row.duplicateKind = match.duplicate.kind;
        row.duplicateDescription = match.duplicate.description;
        if (match.duplicate.kind === 'exact') row.excluded = true;
      }
      // An unmatched merchant is not a reason to block the whole import: use the
      // visible fallback category (usually “Diğer”) and let the user edit it.
      if (!row.category_id) row.category_id = this.fallbackCategory(row.type)?.id ?? null;
      if (!row.category_id) row.error ||= 'Bu işlem türünde kategori bulunamadı.';
    });
    this.changeDetector.detectChanges();
  }

  setBulkType(type: 'Income' | 'Expense'): void {
    this.bulkType = type;
    this.bulkCategoryId = null;
  }

  applyBulkClassification(): void {
    const category = this.categories.find(item => item.id === Number(this.bulkCategoryId) && item.type === this.bulkType);
    if (!category || !this.statement) return;
    for (const row of this.statement.rows) {
      if (row.excluded) continue;
      // Refunds remain expenses so refunds never turn into income.
      if (row.entry_kind !== 'refund') row.type = row.isNegativeAmount ? 'Expense' : this.bulkType;
      const rowCategory = row.type === category.type ? category : this.fallbackCategory(row.type);
      row.category_id = rowCategory?.id ?? null;
      row.category_name = rowCategory?.name ?? null;
      this.confirmRow(row);
    }
    this.changeDetector.detectChanges();
  }

  private fallbackCategory(type: 'Income' | 'Expense'): Category | undefined {
    return this.categories.find(category => category.type === type && category.name.toLocaleLowerCase('tr-TR') === 'diğer')
      || this.categories.find(category => category.type === type);
  }

  isValid(row: ParsedStatementItem): boolean {
    return !!row.transaction_date && !!row.description.trim() && row.originalAmount > 0 && Number.isSafeInteger(row.originalAmount)
      && Number.isSafeInteger(row.amount) && row.amount > 0 && Number(row.exchange_rate) > 0 && !!row.category_id
      && !row.needsReview && !row.error;
  }

  confirmRow(row: ParsedStatementItem): void {
    const category = this.categories.find(item => item.id === row.category_id);
    if (!row.transaction_date || !row.description.trim() || row.originalAmount < 1 || !category || category.type !== row.type) {
      row.error = 'Tarih, açıklama, tutar, yön ve kategori alanlarını kontrol et.';
      return;
    }
    if (row.currency_code !== 'TRY') {
      const rate = Number(String(row.exchange_rate).replace(',', '.'));
      if (!Number.isFinite(rate) || rate <= 0 || !row.rate_effective_date) { row.error = 'Dövizli işlem için geçerli kur ve kur tarihi gerekli.'; return; }
      this.applyManualRate(row);
      if (!row.amount) return;
    } else {
      row.amount = row.originalAmount;
      row.exchange_rate = 1;
      row.rate_source = 'TRY';
      row.rate_effective_date = null;
    }
    row.needsReview = false;
    row.error = '';
  }

  editAmount(row: ParsedStatementItem): void {
    row.isNegativeAmount = /^\s*(?:-|\()\s*\d/.test(row.amountText);
    row.originalAmount = this.parser.parseAmountInput(row.amountText, row.currency_code) ?? 0;
    if (row.isNegativeAmount && row.type !== 'Expense') {
      row.type = 'Expense';
      const expenseCategory = this.fallbackCategory('Expense');
      row.category_id = expenseCategory?.id ?? null;
      row.category_name = expenseCategory?.name ?? null;
      // A leading minus sign determines the direction; don't ask for a second
      // confirmation after applying the expense category.
      if (row.transaction_date && row.description.trim() && row.originalAmount > 0 && row.category_id) {
        row.needsReview = false;
        row.error = '';
      }
    }
    if (row.currency_code === 'TRY') { row.amount = row.originalAmount; row.exchange_rate = 1; row.rate_source = 'TRY'; }
    else this.applyManualRate(row);
    if (row.originalAmount > 0 && row.currency_code === 'TRY') row.error = '';
  }

  changeCurrency(row: ParsedStatementItem): void {
    row.originalAmount = this.parser.parseAmountInput(row.amountText, row.currency_code) ?? 0;
    if (row.currency_code === 'TRY') { row.exchange_rate = 1; row.amount = row.originalAmount; row.tcmb_rate = null; row.rate_source = 'TRY'; row.rate_effective_date = null; row.error = ''; }
    else { row.exchange_rate = ''; row.amount = 0; row.tcmb_rate = null; row.rate_source = 'manual'; row.rate_effective_date = row.transaction_date || null; row.error = 'Kur yükleniyor…'; this.refreshRowRate(row); }
  }

  changeDate(row: ParsedStatementItem): void {
    row.error = '';
    row.duplicateKind = null;
    if (row.currency_code === 'TRY') return;
    row.exchange_rate = '';
    row.amount = 0;
    row.rate_source = 'manual';
    row.rate_effective_date = row.transaction_date || null;
    this.refreshRowRate(row);
  }

  changeType(row: ParsedStatementItem): void {
    if (row.isNegativeAmount) {
      row.type = 'Expense';
      row.category_id = this.fallbackCategory('Expense')?.id ?? null;
      row.category_name = this.fallbackCategory('Expense')?.name ?? null;
      row.needsReview = false;
      row.error = '';
      return;
    }
    row.entry_kind = 'standard';
    row.excluded = false;
    row.category_id = this.fallbackCategory(row.type)?.id ?? null;
    row.category_name = null;
    row.needsReview = true;
    row.error = '';
  }

  changeKind(row: ParsedStatementItem): void {
    row.excluded = row.entry_kind === 'transfer' || row.entry_kind === 'card_payment';
    if (row.entry_kind === 'refund') row.type = 'Expense';
  }

  changeCategory(row: ParsedStatementItem, categoryId: number): void {
    row.category_id = Number(categoryId) || null;
    const category = this.categories.find(item => item.id === row.category_id);
    row.category_name = category?.name ?? null;
    row.learnMerchant = Boolean(row.merchant_name && row.category_id);
  }

  toggleIncluded(row: ParsedStatementItem): void {
    row.excluded = !row.excluded;
    if (row.entry_kind === 'transfer' || row.entry_kind === 'card_payment') row.entry_kind = 'standard';
  }

  private refreshRowRate(row: ParsedStatementItem): void {
    if (!row.transaction_date || !row.originalAmount) { row.error = 'Kur için geçerli tarih ve tutar gerekli.'; return; }
    this.api.getExchangeRatesBatch([{ currency: row.currency_code, date: row.transaction_date }]).subscribe({
      next: response => {
        const quote = response?.quotes[`${row.currency_code}|${row.transaction_date}`]?.quote;
        if (!quote) {
          row.exchange_rate = '';
          row.amount = 0;
          row.rate_source = 'manual';
          row.error = 'Bu tarih için TCMB kuru yok. Kuru tabloda elle girebilirsin.';
          return;
        }
        row.exchange_rate = quote.rate;
        row.tcmb_rate = quote.rate;
        row.rate_source = 'TCMB';
        row.rate_effective_date = quote.effectiveDate;
        row.amount = this.format.convertCurrencyMinor(row.originalAmount, quote.rate, row.currency_code) ?? 0;
        row.error = row.amount ? '' : 'TL karşılığı hesaplanamadı.';
      },
      error: () => { row.exchange_rate = ''; row.amount = 0; row.rate_source = 'manual'; row.error = 'TCMB kur hizmetine ulaşılamıyor. Kuru tabloda elle girebilirsin.'; },
    });
  }

  applyManualRate(row: ParsedStatementItem): void {
    const rate = Number(String(row.exchange_rate).replace(',', '.'));
    const converted = Number.isFinite(rate) && rate > 0 ? this.format.convertCurrencyMinor(row.originalAmount, rate, row.currency_code) : null;
    row.amount = converted ?? 0;
    row.rate_source = row.currency_code === 'TRY' ? 'TRY' : row.tcmb_rate !== null && Number(row.exchange_rate) === row.tcmb_rate ? 'TCMB' : 'manual';
    row.rate_effective_date = row.currency_code === 'TRY' ? null : row.rate_effective_date || row.transaction_date;
    row.error = row.amount ? '' : 'Geçerli kur ve tutar girilmeli.';
  }

  canImport(): boolean {
    // Import valid, selected lines while leaving unresolved lines untouched.
    // A single ambiguous row must not force the user to repair the entire file.
    return !!this.statement && !this.saving && this.selectedRows.length > 0;
  }

  importRows(): void {
    if (!this.canImport() || !this.statement) return;
    this.saving = true;
    this.error = '';
    this.api.importStatement({
      fileSha256: this.statement.fileSha256,
      fileName: this.statement.fileName,
      skippedCount: this.skippedRows,
      items: this.selectedRows.map(row => ({
        type: row.type,
        entry_kind: row.entry_kind,
        amount: row.amount,
        original_amount: row.originalAmount,
        currency_code: row.currency_code,
        exchange_rate: row.currency_code === 'TRY' ? 1 : String(row.exchange_rate).replace(',', '.'),
        tcmb_rate: row.tcmb_rate,
        rate_source: row.rate_source,
        rate_effective_date: row.currency_code === 'TRY' ? null : row.rate_effective_date || row.transaction_date,
        description: row.description,
        merchant_name: row.merchant_name,
        category_id: row.category_id,
        transaction_date: row.transaction_date,
        duplicateKind: row.duplicateKind,
        confirmPotentialDuplicate: row.confirmPotentialDuplicate,
        learnMerchant: row.learnMerchant,
      })),
    }).subscribe({
      next: response => {
        this.result = response.result;
        this.finance.error = '';
        this.notice = response.result.imported === 0 && response.result.duplicates > 0 && !this.finance.allowDuplicateImports
          ? `${response.result.duplicates} mevcut işlem bulundu. Tekrar eklemek için Ayarlar'dan mükerrer işlemlere izin verebilirsin.`
          : `İçe aktarıldı: ${response.result.imported} · mükerrer: ${response.result.duplicates} · atlanan: ${response.result.skipped}`;
        this.finance.load();
        this.finance.notice = response.result.imported > 0
          ? `Ekstre işlendi: ${response.result.imported} eklendi, ${response.result.duplicates} mükerrer, ${response.result.skipped} atlandı.`
          : this.notice;
        this.imported.emit();
      },
      error: response => {
        this.saving = false;
        this.error = response.error?.error || 'Ekstre kaydedilemedi; işlemler veritabanına eklenmedi.';
        this.finance.error = this.error;
        this.finance.notice = '';
      },
      complete: () => this.saving = false,
    });
  }

  dismiss(): void { this.close.emit(); }
}
