import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthUser, FinancePage } from '../../core/models/finance.models';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  @Input({ required: true }) active: FinancePage = 'dashboard';
  @Input({ required: true }) user!: AuthUser;
  @Output() pageChange = new EventEmitter<FinancePage>();

  selectPage(page: FinancePage): void { this.pageChange.emit(page); }
}
