import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { AuthUser, FinancePage } from './core/models/finance.models';
import { AuthService } from './core/services/auth.service';
import { FinanceStoreService } from './core/services/finance-store.service';
import { AuthPageComponent } from './features/auth/auth-page/auth-page.component';
import { CategoriesPageComponent } from './features/categories/categories-page/categories-page.component';
import { CategoryFormComponent } from './features/categories/category-form/category-form.component';
import { DashboardPageComponent } from './features/dashboard/dashboard-page/dashboard-page.component';
import { ReportsPageComponent } from './features/reports/reports-page/reports-page.component';
import { TransactionFormComponent } from './features/transactions/transaction-form/transaction-form.component';
import { TransactionsPageComponent } from './features/transactions/transactions-page/transactions-page.component';
import { SettingsPageComponent } from './features/settings/settings-page/settings-page.component';
import { CalendarPageComponent } from './features/calendar/calendar-page/calendar-page.component';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { TopbarComponent } from './layout/topbar/topbar.component';
import { DeleteConfirmationComponent } from './shared/delete-confirmation/delete-confirmation.component';

@Component({ selector:'app-root',standalone:true,imports:[CommonModule,AuthPageComponent,SidebarComponent,TopbarComponent,DashboardPageComponent,TransactionsPageComponent,ReportsPageComponent,CategoriesPageComponent,SettingsPageComponent,CalendarPageComponent,TransactionFormComponent,CategoryFormComponent,DeleteConfirmationComponent],templateUrl:'./app.component.html',changeDetection: ChangeDetectionStrategy.Eager,
styleUrl:'./app.component.scss' })
export class AppComponent implements OnInit {
  readonly auth=inject(AuthService); readonly finance=inject(FinanceStoreService);
  active:FinancePage='dashboard'; user:AuthUser|null=null;
  readonly formatYear=new Date().getFullYear();
  ngOnInit():void {
    this.auth.sessionExpired$.subscribe(()=>{this.user=null;this.finance.clear();this.auth.resetGoogleButton();});
    this.auth.initialize().subscribe(user=>{this.user=user;if(user){this.auth.startSession(this.finance.sessionTimeoutMinutes);this.finance.load();}});
  }
  signedIn(user:AuthUser):void { this.user=user;this.finance.clear();this.auth.startSession(this.finance.sessionTimeoutMinutes);this.finance.load(); }
  signOut():void { this.auth.signOut().subscribe({next:()=>{this.user=null;this.finance.clear();this.auth.resetGoogleButton();},error:()=>this.finance.error='Oturum kapatılamadı. Yeniden deneyin.'}); }
  setPage(page:FinancePage):void {this.active=page;if(page==='reports')this.finance.loadMonthly();}
  toggleTheme():void {this.finance.toggleTheme();}
}
