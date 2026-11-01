import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({ selector: 'app-categories-page', standalone: true, imports: [CommonModule], templateUrl: './categories-page.component.html', styleUrl: './categories-page.component.scss' })
export class CategoriesPageComponent {
  readonly finance = inject(FinanceStoreService);
  openNew(): void { this.finance.openNewCategory(); }
}
