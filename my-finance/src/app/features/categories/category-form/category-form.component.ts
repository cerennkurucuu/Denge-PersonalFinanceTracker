import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
@Component({selector:'app-category-form',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./category-form.component.html',styleUrl:'./category-form.component.scss'})
export class CategoryFormComponent { readonly finance=inject(FinanceStoreService); close():void{this.finance.categoryModal=false;} }
