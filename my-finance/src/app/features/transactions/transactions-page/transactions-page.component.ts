import { CommonModule } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { FinanceApiService } from '../../../core/services/finance-api.service';
import { Transaction } from '../../../core/models/finance.models';
import { StatementImportComponent } from '../statement-import/statement-import.component';

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [CommonModule, FormsModule, StatementImportComponent],
  templateUrl: './transactions-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './transactions-page.component.scss',
})
export class TransactionsPageComponent {
  readonly finance = inject(FinanceStoreService);
  readonly format = inject(FinanceFormatService);
  private readonly api = inject(FinanceApiService);
  statementOpen = false;
  bulkDeletePrompt = false;
  bulkDeleting = false;
  bulkDeleteError = '';
  private readonly selectedIds = new Set<number>();

  get selectedVisibleTransactions(): Transaction[] {
    return this.finance.visibleTransactions.filter(item => this.selectedIds.has(item.id));
  }

  get allVisibleSelected(): boolean {
    const visible = this.finance.visibleTransactions;
    return visible.length > 0 && visible.every(item => this.selectedIds.has(item.id));
  }

  get someVisibleSelected(): boolean {
    return this.finance.visibleTransactions.some(item => this.selectedIds.has(item.id));
  }

  isSelected(id: number): boolean { return this.selectedIds.has(id); }

  toggleRow(id: number, checked: boolean): void {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  toggleVisibleSelection(checked: boolean): void {
    for (const item of this.finance.visibleTransactions) {
      if (checked) this.selectedIds.add(item.id);
      else this.selectedIds.delete(item.id);
    }
  }

  clearSelection(): void { this.selectedIds.clear(); }

  askBulkDelete(): void {
    if (!this.selectedVisibleTransactions.length) return;
    this.bulkDeleteError = '';
    this.bulkDeletePrompt = true;
  }

  cancelBulkDelete(): void {
    if (this.bulkDeleting) return;
    this.bulkDeletePrompt = false;
    this.bulkDeleteError = '';
  }

  confirmBulkDelete(): void {
    const ids = this.selectedVisibleTransactions.map(item => item.id);
    if (!ids.length || this.bulkDeleting) return;
    this.bulkDeleting = true;
    this.bulkDeleteError = '';
    this.api.deleteTransactions(ids).subscribe({
      next: result => {
        this.bulkDeletePrompt = false;
        this.selectedIds.clear();
        this.finance.notice = `${result.deleted} işlem silindi.`;
        this.finance.load();
      },
      error: response => this.bulkDeleteError = response.error?.error || 'Seçili işlemler silinemedi. Hiçbir kayıt değiştirilmedi.',
      complete: () => this.bulkDeleting = false,
    });
  }

  onStatementImported(): void { this.statementOpen = false; }
}
