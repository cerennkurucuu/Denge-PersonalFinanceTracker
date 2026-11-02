import { CommonModule } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATEGORY_ICON_OPTIONS } from '../../../core/models/category-icons';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
@Component({selector:'app-category-form',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./category-form.component.html',changeDetection: ChangeDetectionStrategy.Eager,
styleUrl:'./category-form.component.scss'})
export class CategoryFormComponent { readonly finance=inject(FinanceStoreService); readonly iconOptions=CATEGORY_ICON_OPTIONS; readonly colorPresets=['#2d6a4f','#40916c','#5b8e7d','#287271','#457b9d','#52796f','#e09f3e','#d97745','#bc6c25','#b56576','#845ec2','#5c677d']; close():void{this.finance.categoryModal=false;} }
