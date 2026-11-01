import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({selector:'app-transaction-form',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./transaction-form.component.html',styleUrl:'./transaction-form.component.scss'})
export class TransactionFormComponent { readonly finance=inject(FinanceStoreService); close():void{this.finance.transactionModal=false;} }
