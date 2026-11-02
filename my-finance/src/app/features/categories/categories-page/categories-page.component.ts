import { CommonModule } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { categoryIconSymbol } from '../../../core/models/category-icons';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({ selector: 'app-categories-page', standalone: true, imports: [CommonModule], templateUrl: './categories-page.component.html', changeDetection: ChangeDetectionStrategy.Eager,
 styleUrl: './categories-page.component.scss' })
export class CategoriesPageComponent {
  readonly finance = inject(FinanceStoreService);
  readonly iconSymbol = categoryIconSymbol;
  openNew(): void { this.finance.openNewCategory(); }
}
