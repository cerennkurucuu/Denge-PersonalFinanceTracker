import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Chart, ChartConfiguration } from 'chart.js';

interface Category { id: number; name: string; type: 'Income' | 'Expense'; color: string; icon: string; is_default: number; }
interface Transaction { id: number; type: 'Income' | 'Expense'; amount: number; description: string; category_id: number; category: string; category_color: string; transaction_date: string; }
interface Summary { balance: number; income: number; expense: number; monthIncome: number; monthExpense: number; previousMonthIncome: number; previousMonthExpense: number; recent: Transaction[]; categories: {name:string;color:string;amount:number}[]; }
interface Monthly { month: string; income: number; expense: number; }

@Component({
  selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html', styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, AfterViewChecked, OnDestroy {
  private readonly http = inject(HttpClient);
  @ViewChild('flowChart') private flowCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('categoryChart') private categoryCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('reportChart') private reportCanvas?: ElementRef<HTMLCanvasElement>;
  private readonly charts: Partial<Record<'flow'|'category'|'report', Chart<any, any, any>>> = {};
  private readonly chartSignatures: Partial<Record<'flow'|'category'|'report', string>> = {};
  private chartRegistered = false;
  active: 'dashboard' | 'transactions' | 'reports' | 'categories' = 'dashboard';
  summary: Summary = { balance:0,income:0,expense:0,monthIncome:0,monthExpense:0,previousMonthIncome:0,previousMonthExpense:0,recent:[],categories:[] };
  transactions: Transaction[] = []; categories: Category[] = []; monthly: Monthly[] = [];
  loading = true; error = ''; modalError = ''; notice = ''; dark = false; modal = false; categoryModal = false; editingId: number | null = null;
  deletePrompt: { kind: 'transaction'|'category'; id: number; label: string } | null = null;
  filter = 'All'; reportYear = new Date().getFullYear();
  form = { type: 'Expense' as 'Income'|'Expense', amount: '' as string|number, description: '', category_id: 0, transaction_date: this.localDate(new Date()) };
  categoryForm = { id: 0, name: '', type: 'Expense' as 'Income'|'Expense', color: '#7c6cf2', icon: 'circle' };
  readonly months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  readonly currentDate = this.localDate(new Date());
  readonly money = new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2});
  private localDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  toCents(value: string|number|null): number | null {
    if(value===null)return null;
    const normalized=String(value).trim().replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))return null;
    const [whole,fraction='']=normalized.split('.');
    const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    return Number.isSafeInteger(cents)?cents:null;
  }
  ngOnInit(): void { this.load(); this.http.get<{theme:string}>('/api/settings').subscribe({next:s=>{this.dark=s.theme==='dark';this.applyTheme();}}); }
  ngAfterViewChecked(): void {
    this.syncChart('flow', this.flowCanvas?.nativeElement, this.monthly, () => this.monthlyConfig());
    this.syncChart('category', this.categoryCanvas?.nativeElement, this.summary.categories, () => this.categoryConfig());
    this.syncChart('report', this.reportCanvas?.nativeElement, this.monthly, () => this.monthlyConfig());
  }
  ngOnDestroy(): void { Object.values(this.charts).forEach(chart=>chart?.destroy()); }
  private syncChart(key: 'flow'|'category'|'report', canvas: HTMLCanvasElement|undefined, data: unknown, config: () => ChartConfiguration<any, any, any>): void {
    if (!canvas) { this.charts[key]?.destroy(); delete this.charts[key]; delete this.chartSignatures[key]; return; }
    const signature=JSON.stringify(data);
    if (signature===this.chartSignatures[key]) return;
    this.chartSignatures[key]=signature;
    void import('chart.js').then(({ArcElement,BarController,BarElement,CategoryScale,Chart,DoughnutController,LinearScale,Tooltip})=>{
      if (!canvas.isConnected || this.chartSignatures[key]!==signature) return;
      if (!this.chartRegistered) { Chart.register(ArcElement,BarController,BarElement,CategoryScale,DoughnutController,LinearScale,Tooltip); this.chartRegistered=true; }
      this.charts[key]?.destroy(); this.charts[key]=new Chart(canvas,config());
    }).catch(()=>{delete this.chartSignatures[key];this.error='Grafikler yüklenemedi.';});
  }
  private monthlyConfig(): ChartConfiguration<'bar', number[], string> {
    return { type:'bar', data:{ labels:this.monthly.map(item=>this.monthName(item.month)), datasets:[
      { label:'Gelir',data:this.monthly.map(item=>item.income/100),backgroundColor:'#8071e5',borderRadius:4,borderSkipped:false,barPercentage:.66,categoryPercentage:.68 },
      { label:'Gider',data:this.monthly.map(item=>item.expense/100),backgroundColor:'#c1baf3',borderRadius:4,borderSkipped:false,barPercentage:.66,categoryPercentage:.68 }
    ]}, options:{ responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>`${context.dataset.label}: ${this.money.format(Number(context.raw))}`}}},scales:{x:{grid:{display:false},ticks:{color:'#9694a3',font:{size:9}}},y:{beginAtZero:true,grid:{color:'#eeedf2'},ticks:{color:'#9694a3',font:{size:8},callback:value=>this.money.format(Number(value))}}} } };
  }
  private categoryConfig(): ChartConfiguration<'doughnut', number[], string> {
    return { type:'doughnut',data:{labels:this.summary.categories.map(item=>item.name),datasets:[{data:this.summary.categories.map(item=>item.amount/100),backgroundColor:this.summary.categories.map(item=>item.color),borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:'76%',plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>`${context.label}: ${this.money.format(Number(context.raw))}`}}}} };
  }
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
  monthChange(current: number, previous: number): string {
    if(previous===0)return current===0?'Değişim yok':'Geçen ay verisi yok';
    const percent=(current-previous)/previous*100;
    return `${percent>=0?'↗':'↘'} ${Math.abs(percent).toLocaleString('tr-TR',{maximumFractionDigits:1})}% geçen aya göre`;
  }
  fmt(cents: number): string { return this.money.format(cents/100); }
  date(value: string): string { const [y,m,d]=value.slice(0,10).split('-'); return `${d}.${m}.${y}`; }
  setPage(page: typeof this.active): void { this.active=page; if(page==='reports')this.loadMonthly(); }
  openNew(type: 'Income'|'Expense'='Expense'): void { this.editingId=null;this.modalError='';this.form={type,amount:'',description:'',category_id:0,transaction_date:this.localDate(new Date())};this.modal=true; }
  edit(item: Transaction): void { this.editingId=item.id;this.modalError='';this.form={type:item.type,amount:(item.amount/100).toFixed(2),description:item.description,category_id:item.category_id,transaction_date:item.transaction_date.slice(0,10)};this.modal=true; }
  save(): void {
    this.modalError='';
    const amount=this.toCents(this.form.amount);
    if(!this.form.description.trim()||!this.form.category_id||amount===null||amount<=0||!this.form.transaction_date){this.modalError='Açıklama, kategori, geçerli tarih ve sıfırdan büyük (en fazla iki ondalık basamaklı) tutar girin.';return;}
    const body={...this.form,amount}; const request=this.editingId?this.http.put(`/api/transactions/${this.editingId}`,body):this.http.post('/api/transactions',body);
    request.subscribe({next:()=>{this.modal=false;this.modalError='';this.notice=this.editingId?'İşlem güncellendi.':'İşlem eklendi.';this.error='';this.load();},error:e=>this.modalError=e.error?.error||'İşlem kaydedilemedi.'});
  }
  remove(item: Transaction): void { this.deletePrompt={kind:'transaction',id:item.id,label:item.description}; }
  removeCategory(category: Category): void { if(category.is_default)return;this.deletePrompt={kind:'category',id:category.id,label:category.name}; }
  cancelDelete(): void { this.deletePrompt=null; }
  confirmDelete(): void {
    const pending=this.deletePrompt;if(!pending)return;
    const endpoint=pending.kind==='transaction'?`/api/transactions/${pending.id}`:`/api/categories/${pending.id}`;
    this.http.delete(endpoint).subscribe({
      next:()=>{this.deletePrompt=null;this.error='';this.notice=pending.kind==='transaction'?'İşlem silindi.':'Kategori silindi.';this.load();},
      error:e=>{this.deletePrompt=null;this.error=e.error?.error||(pending.kind==='transaction'?'İşlem silinemedi.':'Kategori silinemedi.');}
    });
  }
  toggleTheme(): void { this.dark=!this.dark;this.applyTheme();this.http.put('/api/settings',{theme:this.dark?'dark':'light'}).subscribe(); }
  private applyTheme(): void { document.documentElement.dataset['theme']=this.dark?'dark':'light'; }
  saveCategory(): void {
    this.modalError='';
    const body={name:this.categoryForm.name.trim(),type:this.categoryForm.type,color:this.categoryForm.color,icon:this.categoryForm.icon};
    if(!body.name){this.modalError='Kategori adı gerekli.';return;}
    const request=this.categoryForm.id?this.http.put(`/api/categories/${this.categoryForm.id}`,body):this.http.post('/api/categories',body);
    request.subscribe({next:()=>{this.categoryModal=false;this.modalError='';this.load();this.notice='Kategori kaydedildi.';},error:e=>this.modalError=e.error?.error||'Kategori kaydedilemedi.'});
  }
  editCategory(category: Category): void { if(category.is_default)return;this.modalError='';this.categoryForm={id:category.id,name:category.name,type:category.type,color:category.color,icon:category.icon};this.categoryModal=true; }
  exportCsv(): void {
    const rows=[['Tarih','Tür','Açıklama','Kategori','Tutar (TRY)'],...this.visibleTransactions.map(t=>[this.date(t.transaction_date),t.type==='Income'?'Gelir':'Gider',t.description,t.category,(t.amount/100).toFixed(2)])];
    const csv='\uFEFF'+rows.map(row=>row.map(cell=>`"${String(cell).replaceAll('"','""')}"`).join(';')).join('\r\n');
    const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='denge-islemler.csv';link.click();URL.revokeObjectURL(link.href);
  }
  monthName(month:string): string { return this.months[Number(month)-1]||''; }
}
