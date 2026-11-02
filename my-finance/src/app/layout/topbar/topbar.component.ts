import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, ChangeDetectionStrategy } from '@angular/core';
import { FinancePage } from '../../core/models/finance.models';
import { FinanceFormatService } from '../../core/services/finance-format.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './topbar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  readonly format = inject(FinanceFormatService);
  @Input({ required: true }) active: FinancePage = 'dashboard';
  @Input() dark = false;
  @Output() themeToggle = new EventEmitter<void>();
  @Output() newTransaction = new EventEmitter<void>();
  @Output() signOut = new EventEmitter<void>();

  get pageTitle(): string {
    return { dashboard: 'Genel Bakış', transactions: 'İşlemler', reports: 'Raporlar', categories: 'Kategoriler' }[this.active];
  }
}
