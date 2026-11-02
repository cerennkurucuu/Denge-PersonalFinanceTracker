import { CommonModule } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transactions-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './transactions-page.component.scss',
})
export class TransactionsPageComponent {
  readonly finance = inject(FinanceStoreService);
  readonly format = inject(FinanceFormatService);
}
