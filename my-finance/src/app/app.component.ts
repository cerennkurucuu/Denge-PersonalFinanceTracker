import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, ChangeDetectionStrategy, DOCUMENT } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
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
import { LandingPageComponent } from './features/landing/landing-page/landing-page.component';
import { HelpCenterComponent } from './shared/help-center/help-center.component';
import { ProductTourComponent } from './shared/product-tour/product-tour.component';

@Component({ selector:'app-root',standalone:true,imports:[CommonModule,AuthPageComponent,SidebarComponent,TopbarComponent,DashboardPageComponent,TransactionsPageComponent,ReportsPageComponent,CategoriesPageComponent,SettingsPageComponent,CalendarPageComponent,TransactionFormComponent,CategoryFormComponent,DeleteConfirmationComponent,LandingPageComponent,HelpCenterComponent,ProductTourComponent],templateUrl:'./app.component.html',changeDetection: ChangeDetectionStrategy.Eager,
styleUrl:'./app.component.scss' })
export class AppComponent implements OnInit {
  readonly auth=inject(AuthService); readonly finance=inject(FinanceStoreService);
  private readonly title=inject(Title); private readonly meta=inject(Meta); private readonly document=inject(DOCUMENT);
  active:FinancePage='dashboard'; user:AuthUser|null=null;
  readonly formatYear=new Date().getFullYear();
  authView: 'landing'|'login'='landing';
  publicSiteRequested=typeof window!=='undefined'&&window.location.pathname.replace(/\/$/,'')==='/tanitim';
  showHelp=false;
  showTour=false;
  private tourPrompted=false;
  ngOnInit():void {
    this.updateSeo();
    this.auth.sessionExpired$.subscribe(()=>{this.user=null;this.authView='landing';this.updateSeo();this.finance.clear();this.auth.resetGoogleButton();});
    this.auth.initialize().subscribe(user=>{this.user=user;this.updateSeo();if(user){this.auth.startSession(this.finance.sessionTimeoutMinutes);this.finance.load();this.promptTour(user);}});
  }
  signedIn(user:AuthUser):void { this.user=user;this.updateSeo();this.finance.clear();this.auth.startSession(this.finance.sessionTimeoutMinutes);this.finance.load();this.promptTour(user); }
  signOut():void { this.auth.signOut().subscribe({next:()=>{this.user=null;this.authView='landing';this.updateSeo();this.finance.clear();this.auth.resetGoogleButton();},error:()=>this.finance.error='Oturum kapatılamadı. Yeniden deneyin.'}); }
  setPage(page:FinancePage):void {this.active=page;if(page==='reports')this.finance.loadMonthly();}
  toggleTheme():void {this.finance.toggleTheme();}
  private promptTour(user:AuthUser):void { if(this.tourPrompted)return;this.tourPrompted=true;try{const key=`denge-tour-seen:${user.id}`;if(!localStorage.getItem(key)){this.showTour=true;localStorage.setItem(key,'1');}}catch{this.showTour=true;} }
  openTour():void { this.showTour=true; }
  enterProgram():void { this.publicSiteRequested=false;this.updateSeo();if(this.user)return;this.authView='login'; }
  private updateSeo():void { const publicPage=!this.user||this.publicSiteRequested;this.title.setTitle(publicPage?'Denge — Kişisel Finans Takibi':'Denge | Kişisel Alan');this.meta.updateTag({name:'description',content:'Gelir ve giderlerini takip et, ödemelerini planla, birikim hedeflerini ve finansal raporlarını tek yerde incele.'});this.meta.updateTag({name:'robots',content:publicPage?'index, follow, max-image-preview:large':'noindex, nofollow, noarchive'});this.document.documentElement.lang='tr'; }
}
