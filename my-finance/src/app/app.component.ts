import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Category { id: number; name: string; type: 'Income' | 'Expense'; color: string; icon: string; is_default: number; }
interface Transaction { id: number; type: 'Income' | 'Expense'; amount: number; description: string; category_id: number; category: string; category_color: string; transaction_date: string; }
interface Summary { balance: number; income: number; expense: number; monthIncome: number; monthExpense: number; previousMonthIncome: number; previousMonthExpense: number; recent: Transaction[]; categories: {name:string;color:string;amount:number}[]; }
interface Monthly { month: string; income: number; expense: number; }

@Component({
  selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html', styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  private readonly http = inject(HttpClient);
  active: 'dashboard' | 'transactions' | 'reports' | 'categories' = 'dashboard';
  summary: Summary = { balance:0,income:0,expense:0,monthIncome:0,monthExpense:0,previousMonthIncome:0,previousMonthExpense:0,recent:[],categories:[] };
  transactions: Transaction[] = []; categories: Category[] = []; monthly: Monthly[] = [];
  loading = true; error = ''; notice = ''; dark = false; modal = false; categoryModal = false; editingId: number | null = null;
  filter = 'All'; reportYear = new Date().getFullYear();
  form = { type: 'Expense' as 'Income'|'Expense', amount: '', description: '', category_id: 0, transaction_date: new Date().toISOString().slice(0,10) };
  categoryForm = { id: 0, name: '', type: 'Expense' as 'Income'|'Expense', color: '#7c6cf2', icon: 'circle' };
  readonly months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  readonly currentDate = new Date().toISOString();
  readonly money = new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2});
  ngOnInit(): void { this.load(); this.http.get<{theme:string}>('/api/settings').subscribe({next:s=>{this.dark=s.theme==='dark';this.applyTheme();}}); }
  load(): void {
    this.loading = true; this.error = '';
    this.http.get<Category[]>('/api/categories').subscribe({next:v=>this.categories=v,error:()=>this.error='Kategoriler yüklenemedi. API sunucusunun çalıştığından emin olun.'});
    this.http.get<Transaction[]>('/api/transactions').subscribe({next:v=>{this.transactions=v;this.loading=false;},error:()=>{this.loading=false;this.error='Veriler yüklenemedi. API sunucusunun çalıştığından emin olun.';}});
    this.http.get<Summary>('/api/dashboard/summary').subscribe({next:v=>this.summary=v,error:()=>this.error='Özet bilgisi alınamadı.'});
    this.loadMonthly();
  }
  loadMonthly(): void { this.http.get<Monthly[]>(`/api/reports/monthly?year=${this.reportYear}`).subscribe({next:v=>this.monthly=v}); }
  get visibleTransactions(): Transaction[] { return this.filter==='All'?this.transactions:this.transactions.filter(t=>t.type===this.filter); }
  get availableCategories(): Category[] { return this.categories.filter(c=>c.type===this.form.type); }
  get expenseCategories(): Category[] { return this.categories.filter(c=>c.type==='Expense'); }
  get incomeCategories(): Category[] { return this.categories.filter(c=>c.type==='Income'); }
  get monthMax(): number { return Math.max(1,...this.monthly.flatMap(m=>[m.income,m.expense])); }
  get monthSavings(): number { return this.summary.monthIncome-this.summary.monthExpense; }
  get yearIncome(): number { return this.monthly.reduce((total,item)=>total+item.income,0); }
  get yearExpense(): number { return this.monthly.reduce((total,item)=>total+item.expense,0); }
  get yearSavings(): number { return this.yearIncome-this.yearExpense; }
  get donutGradient(): string {
    const total=this.summary.categories.reduce((sum,category)=>sum+category.amount,0);
    if(!total)return 'conic-gradient(#e9e6f8 0 100%)';
    let cursor=0;
    const segments=this.summary.categories.map(category=>{const start=cursor;cursor+=category.amount/total*100;return `${category.color} ${start}% ${cursor}%`;});
    return `conic-gradient(${segments.join(',')})`;
  }
  fmt(cents: number): string { return this.money.format(cents/100); }
  date(value: string): string { const [y,m,d]=value.slice(0,10).split('-'); return `${d}.${m}.${y}`; }
  setPage(page: typeof this.active): void { this.active=page; if(page==='reports')this.loadMonthly(); }
  openNew(type: 'Income'|'Expense'='Expense'): void { this.editingId=null;this.form={type,amount:'',description:'',category_id:0,transaction_date:new Date().toISOString().slice(0,10)};this.modal=true; }
  edit(item: Transaction): void { this.editingId=item.id;this.form={type:item.type,amount:(item.amount/100).toFixed(2),description:item.description,category_id:item.category_id,transaction_date:item.transaction_date.slice(0,10)};this.modal=true; }
  save(): void {
    const amount=Math.round(Number(this.form.amount)*100);
    if(!this.form.description.trim()||!this.form.category_id||!Number.isSafeInteger(amount)||amount<=0||!this.form.transaction_date){this.error='Açıklama, kategori, geçerli tarih ve sıfırdan büyük tutar girin.';return;}
    const body={...this.form,amount}; const request=this.editingId?this.http.put(`/api/transactions/${this.editingId}`,body):this.http.post('/api/transactions',body);
    request.subscribe({next:()=>{this.modal=false;this.notice=this.editingId?'İşlem güncellendi.':'İşlem eklendi.';this.error='';this.load();},error:e=>this.error=e.error?.error||'İşlem kaydedilemedi.'});
  }
  remove(item: Transaction): void { if(!confirm(`“${item.description}” işlemi silinsin mi?`))return;this.http.delete(`/api/transactions/${item.id}`).subscribe({next:()=>{this.notice='İşlem silindi.';this.load();},error:()=>this.error='İşlem silinemedi.'}); }
  toggleTheme(): void { this.dark=!this.dark;this.applyTheme();this.http.put('/api/settings',{theme:this.dark?'dark':'light'}).subscribe(); }
  private applyTheme(): void { document.documentElement.dataset['theme']=this.dark?'dark':'light'; }
  saveCategory(): void {
    const body={name:this.categoryForm.name.trim(),type:this.categoryForm.type,color:this.categoryForm.color,icon:this.categoryForm.icon};
    if(!body.name){this.error='Kategori adı gerekli.';return;}
    const request=this.categoryForm.id?this.http.put(`/api/categories/${this.categoryForm.id}`,body):this.http.post('/api/categories',body);
    request.subscribe({next:()=>{this.categoryModal=false;this.load();this.notice='Kategori kaydedildi.';},error:e=>this.error=e.error?.error||'Kategori kaydedilemedi.'});
  }
  editCategory(category: Category): void { if(category.is_default)return;this.categoryForm={id:category.id,name:category.name,type:category.type,color:category.color,icon:category.icon};this.categoryModal=true; }
  removeCategory(category: Category): void { if(category.is_default||!confirm(`${category.name} kategorisi silinsin mi?`))return;this.http.delete(`/api/categories/${category.id}`).subscribe({next:()=>this.load(),error:e=>this.error=e.error?.error||'Kategori silinemedi.'}); }
  exportCsv(): void {
    const rows=[['Tarih','Tür','Açıklama','Kategori','Tutar (TRY)'],...this.visibleTransactions.map(t=>[this.date(t.transaction_date),t.type==='Income'?'Gelir':'Gider',t.description,t.category,(t.amount/100).toFixed(2)])];
    const csv='\uFEFF'+rows.map(row=>row.map(cell=>`"${String(cell).replaceAll('"','""')}"`).join(';')).join('\r\n');
    const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='denge-islemler.csv';link.click();URL.revokeObjectURL(link.href);
  }
  monthName(month:string): string { return this.months[Number(month)-1]||''; }
}
