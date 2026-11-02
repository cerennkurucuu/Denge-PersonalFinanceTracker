import { CommonModule } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FinanceStoreService } from '../../core/services/finance-store.service';
@Component({selector:'app-delete-confirmation',standalone:true,imports:[CommonModule],templateUrl:'./delete-confirmation.component.html',changeDetection: ChangeDetectionStrategy.Eager,
styleUrl:'./delete-confirmation.component.scss'})
export class DeleteConfirmationComponent { readonly finance=inject(FinanceStoreService); }
