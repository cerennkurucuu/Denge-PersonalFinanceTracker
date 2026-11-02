import { CommonModule } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';

@Component({selector:'app-transaction-form',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./transaction-form.component.html',changeDetection: ChangeDetectionStrategy.Eager,
styleUrl:'./transaction-form.component.scss'})
export class TransactionFormComponent { readonly finance=inject(FinanceStoreService); readonly format=inject(FinanceFormatService); close():void{this.finance.transactionModal=false;} }
