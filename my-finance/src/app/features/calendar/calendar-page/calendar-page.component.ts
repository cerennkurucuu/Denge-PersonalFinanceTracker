import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CalendarApiService } from '../../../core/services/calendar-api.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { CalendarActual, CalendarKind, CalendarOccurrence, CalendarPlan, CalendarPlanInput, CalendarSnapshot, CashflowProjection } from '../../../core/models/calendar.models';

interface CalendarDay { date: string; label: number; inMonth: boolean; actual: number; planned: number; linked: number; other: number; }
interface MonthlyOutflow { date: string; amount: number; count: number; entries: string[]; }
const iso = (date: Date) => date.toISOString().slice(0,10);
const dayDistance = (a: string,b: string) => Math.abs(new Date(`${a}T00:00:00Z`).getTime()-new Date(`${b}T00:00:00Z`).getTime())/86400000;

@Component({
  selector: 'app-calendar-page', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './calendar-page.component.html', styleUrl: './calendar-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class CalendarPageComponent implements OnInit, OnDestroy {
  @Input() initialView: 'plans' | 'calendar' | 'forecast' = 'calendar';
  readonly finance = inject(FinanceStoreService);
  readonly format = inject(FinanceFormatService);
  private readonly api = inject(CalendarApiService);
  readonly kinds: Array<{ value: CalendarKind; label: string }> = [
    {value:'salary',label:'Maaş / düzenli gelir'}, {value:'rent',label:'Kira'}, {value:'bill',label:'Fatura'},
    {value:'loan',label:'Kredi taksiti'}, {value:'credit_card',label:'Kredi kartı son ödeme'}, {value:'subscription',label:'Abonelik'},
    {value:'planned_income',label:'Planlanan gelir'}, {value:'planned_expense',label:'Planlanan gider'}, {value:'savings',label:'Birikime ayrılacak tutar'},
  ];
  readonly frequencyLabels = {none:'Tek sefer',daily:'Her gün',weekly:'Her hafta',monthly:'Her ay',yearly:'Her yıl'};
  readonly weekdays = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
  today = this.format.currentDateForToday;
  month = this.today.slice(0,7);
  selectedDate = this.today;
  occurrencePage=0; actualPage=0;
  planPage=0;
  days: CalendarDay[] = [];
  snapshot: CalendarSnapshot | null = null;
  projection: CashflowProjection | null = null;
  selectedOccurrences: CalendarOccurrence[] = [];
  selectedActual: CalendarActual[] = [];
  calendarLoading = false; forecastLoading = false; saving = false; actionBusy = false;
  calendarError = ''; forecastError = ''; formError = ''; actionError = '';
  horizon = 30;
  activeView: 'plans' | 'calendar' | 'forecast' = 'calendar';
  readonly selectedPlanIds = new Set<number>();
  bulkCategoryId: number | null = null;
  bulkFixed: 'unchanged' | 'true' | 'false' = 'unchanged';
  showForm = false;
  editingId: number | null = null;
  deleteTarget: CalendarPlan | null = null;
  linkTarget: CalendarOccurrence | null = null;
  linkSearch = '';
  linkTransaction: number | null = null;
  amountInput = '';
  repeatMonths: number | null = 12;
  form: CalendarPlanInput = this.emptyForm();
  private calendarRequest?: Subscription;
  private forecastRequest?: Subscription;
  private readonly mutations = new Subscription();
  private occurrenceGroups = new Map<string,CalendarOccurrence[]>();
  private actualGroups = new Map<string,CalendarActual[]>();

  ngOnInit(): void { this.activeView=this.initialView; this.reload(); }
  ngOnDestroy(): void { this.calendarRequest?.unsubscribe(); this.forecastRequest?.unsubscribe(); this.mutations.unsubscribe(); }
  reload(): void { if(this.activeView==='forecast')this.loadForecast();else this.loadCalendar(); }
  setView(view:'plans'|'calendar'|'forecast'):void {this.activeView=view;this.reload();}
  labelKind(kind: CalendarKind): string { return this.kinds.find(item=>item.value===kind)?.label || kind; }
  money(value: number | null | undefined): string { return value === null || value === undefined ? 'Hesaplanmadı' : this.format.formatAmount(value); }
  statusLabel(status: CalendarOccurrence['status']): string { return {pending:'Planlanan',linked:'Kayıtlı işleme bağlı',reserved:'Birikime ayrıldı',skipped:'Bu tarih atlandı'}[status]; }
  frequencyDescription(plan:CalendarPlan):string {
    if(plan.frequency==='monthly')return plan.end_date?(this.monthDistance(plan.start_date,plan.end_date)+1)+' ay · her ay':'Her ay · süresiz';
    return this.frequencyLabels[plan.frequency];
  }
  get categories() { return this.finance.categories.filter(item=>item.type===this.form.type); }
  get visiblePlans() { return (this.snapshot?.plans || []).slice(this.planPage*10,(this.planPage+1)*10); }
  get planPageCount() { return Math.ceil((this.snapshot?.plans?.length || 0)/10); }
  get allVisiblePlansSelected():boolean {return this.visiblePlans.length>0&&this.visiblePlans.every(plan=>this.selectedPlanIds.has(Number(plan.id)));}
  togglePlanSelection(planId:number,selected:boolean):void {if(selected)this.selectedPlanIds.add(planId);else this.selectedPlanIds.delete(planId);}
  toggleVisiblePlanSelection(selected:boolean):void {for(const plan of this.visiblePlans)this.togglePlanSelection(Number(plan.id),selected);}
  clearPlanSelection():void {this.selectedPlanIds.clear();this.bulkCategoryId=null;this.bulkFixed='unchanged';}
  showInCalendar(date:string):void {this.month=date.slice(0,7);this.selectedDate=date;this.setView('calendar');}
  get selectedPlanCategoryType(): 'Income'|'Expense'|null {
    const selected=(this.snapshot?.plans||[]).filter(plan=>this.selectedPlanIds.has(Number(plan.id)));
    if(!selected.length||selected.some(plan=>plan.kind==='savings'))return null;
    const type=selected[0].type;
    return selected.every(plan=>plan.type===type)?type:null;
  }
  get canBulkSetFixed():boolean {
    const selected=(this.snapshot?.plans||[]).filter(plan=>this.selectedPlanIds.has(Number(plan.id)));
    return selected.length>0&&selected.every(plan=>plan.type==='Expense'&&plan.kind!=='savings');
  }
  get bulkCategories(){return this.finance.categories.filter(category=>category.type===this.selectedPlanCategoryType);}
  get monthlyOutflows(): MonthlyOutflow[] {
    if(!this.snapshot)return [];
    const firstOfMonth=this.month+'-01';
    const firstRelevant=this.month<this.today.slice(0,7)?'9999-12-31':this.month===this.today.slice(0,7)?this.today:firstOfMonth;
    const groups=new Map<string,{amount:bigint;entries:string[]}>();
    const add=(date:string,amount:number,label:string)=>{
      if(date<firstRelevant||date<firstOfMonth||date.slice(0,7)!==this.month)return;
      const group=groups.get(date)||{amount:0n,entries:[]};group.amount+=BigInt(amount);group.entries.push(label);groups.set(date,group);
    };
    for(const occurrence of this.snapshot.occurrences)if(occurrence.type==='Expense'&&occurrence.kind!=='savings'&&occurrence.status==='pending'&&!occurrence.candidateTransactionIds.length)add(occurrence.occurrence_date,occurrence.amount,occurrence.title+' · planlanan');
    for(const transaction of this.snapshot.transactions)if(transaction.transaction_date>this.today&&transaction.type==='Expense'&&(transaction.entry_kind||'standard')==='standard')add(transaction.transaction_date,transaction.amount,transaction.description+' · ileri tarihli kayıt');
    return [...groups].filter(([,group])=>group.amount>0n).sort(([a],[b])=>a.localeCompare(b)).map(([date,group])=>({date,amount:group.amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(group.amount):0,count:group.entries.length,entries:group.entries}));
  }
  get monthlyOutflowTotal(): number | null {
    const outflows=this.monthlyOutflows;
    if(outflows.some(item=>item.amount===0))return null;
    const total=outflows.reduce((sum,item)=>sum+BigInt(item.amount),0n);
    return total<=BigInt(Number.MAX_SAFE_INTEGER)?Number(total):null;
  }
  get uncertainOutflowCount(): number {return (this.snapshot?.occurrences||[]).filter(item=>item.occurrence_date.slice(0,7)===this.month&&item.status==='pending'&&item.type==='Expense'&&item.kind!=='savings'&&item.candidateTransactionIds.length>0).length;}
  get linkOptions() {
    if (!this.linkTarget) return [];
    const target=this.linkTarget,search=this.linkSearch.toLocaleLowerCase('tr-TR').trim();
    return this.finance.transactions.filter(item=>item.type===target.type && (item.entry_kind || 'standard')==='standard' && dayDistance(item.transaction_date,target.occurrence_date)<=31 && (!search || `${item.description} ${item.id}`.toLocaleLowerCase('tr-TR').includes(search))).slice(0,100);
  }
  changeMonth(offset: number): void {
    const [year,month]=this.month.split('-').map(Number);
    this.month=iso(new Date(Date.UTC(year,month-1+offset,1))).slice(0,7); this.loadCalendar();
  }
  selectDate(date: string): void {
    this.selectedDate=date;this.occurrencePage=0;this.actualPage=0;
    this.selectedOccurrences=this.occurrenceGroups.get(date)||[];
    this.selectedActual=this.actualGroups.get(date)||[];
    this.linkTarget=null;
  }
  loadCalendar(): void {
    if (!/^\d{4}-\d{2}$/.test(this.month)) return;
    const [year,month]=this.month.split('-').map(Number);
    if (month<1||month>12||year<1900||year>2100) return;
    const first=new Date(Date.UTC(year,month-1,1));
    const start=new Date(first);start.setUTCDate(1-(first.getUTCDay()+6)%7);
    const last=new Date(Date.UTC(year,month,0));last.setUTCDate(last.getUTCDate()+(7-last.getUTCDay())%7);
    this.calendarRequest?.unsubscribe();this.calendarLoading=true;this.calendarError='';
    this.calendarRequest=this.api.getCalendar(iso(start),iso(last)).subscribe({
      next: snapshot=>{
        this.snapshot=snapshot;this.planPage=Math.min(this.planPage,Math.max(0,Math.ceil(snapshot.plans.length/10)-1));this.calendarLoading=false;
        this.occurrenceGroups=new Map();this.actualGroups=new Map();
        for(const item of snapshot.occurrences){const list=this.occurrenceGroups.get(item.occurrence_date)||[];list.push(item);this.occurrenceGroups.set(item.occurrence_date,list);}
        for(const item of snapshot.transactions){const list=this.actualGroups.get(item.transaction_date)||[];list.push(item);this.actualGroups.set(item.transaction_date,list);}
        this.days=[];
        for(let date=new Date(start);date<=last;date.setUTCDate(date.getUTCDate()+1)){
          const value=iso(date),items=this.occurrenceGroups.get(value)||[];this.days.push({date:value,label:date.getUTCDate(),inMonth:value.startsWith(this.month),actual:this.actualGroups.get(value)?.length||0,planned:items.filter(item=>item.status==='pending').length,linked:items.filter(item=>item.status==='linked').length,other:items.filter(item=>item.status==='reserved'||item.status==='skipped').length});
        }
        this.selectDate(this.days.some(item=>item.date===this.selectedDate)?this.selectedDate:iso(first));
      },error: response=>{this.calendarLoading=false;this.snapshot=null;this.days=[];this.selectedActual=[];this.selectedOccurrences=[];this.calendarError=response.error?.error||'Finansal takvim yüklenemedi.';},
    });
  }
  loadForecast(): void {
    this.forecastRequest?.unsubscribe();this.forecastLoading=true;this.forecastError='';
    this.forecastRequest=this.api.getCashflow(this.horizon).subscribe({
      next: projection=>{this.projection=projection;this.today=projection.today;this.forecastLoading=false;},
      error: response=>{this.projection=null;this.forecastLoading=false;this.forecastError=response.error?.error||'Nakit akışı hesaplanamadı.';},
    });
  }
  newPlan(): void {this.editingId=null;this.form=this.emptyForm();this.form.start_date=this.selectedDate;this.amountInput='';this.formError='';this.showForm=true;this.changeKind();this.focusRegion('calendar-title');}
  editPlan(plan: CalendarPlan): void {
    this.editingId=Number(plan.id);this.form={...plan,amount:Number(plan.amount),category_id:plan.category_id===null?null:Number(plan.category_id),is_fixed:!!plan.is_fixed};
    this.repeatMonths=plan.frequency==='monthly'&&plan.end_date?this.monthDistance(plan.start_date,plan.end_date)+1:null;
    this.amountInput=this.format.formatMinorUnits(Number(plan.amount),'TRY');this.formError='';this.showForm=true;this.focusRegion('calendar-title');
  }
  changeKind(): void {
    this.form.type=['salary','planned_income'].includes(this.form.kind)?'Income':'Expense';
    this.form.category_id=this.form.kind==='savings'?null:this.finance.preferredCategory(this.form.type)?.id||this.categories[0]?.id||null;
    this.form.is_fixed=!['planned_income','planned_expense'].includes(this.form.kind);
  }
  changeFrequency(frequency: CalendarPlanInput['frequency']): void {
    this.form.frequency=frequency;
    if(frequency==='monthly'&&this.repeatMonths===null)this.repeatMonths=12;
  }
  private monthDistance(from:string,to:string):number {
    const [fy,fm]=from.slice(0,7).split('-').map(Number),[ty,tm]=to.slice(0,7).split('-').map(Number);
    return Math.max(0,(ty-fy)*12+tm-fm);
  }
  private monthlyEndDate(months:number):string {
    const [year,month,day]=this.form.start_date.split('-').map(Number),target=new Date(Date.UTC(year,month-1+months-1,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
    return iso(new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(day,last))));
  }
  get calculatedMonthlyEnd():string|null {return this.form.frequency==='monthly'&&this.repeatMonths&&this.repeatMonths>=1&&this.repeatMonths<=360?this.monthlyEndDate(this.repeatMonths):null;}
  savePlan(): void {
    const amount=this.format.toCents(this.amountInput);
    if(!this.form.title.trim()||amount===null||amount<=0||!this.form.start_date||(this.form.frequency==='monthly'&&this.repeatMonths!==null&&(!Number.isInteger(this.repeatMonths)||this.repeatMonths<1||this.repeatMonths>360))||(this.form.frequency!=='monthly'&&this.form.end_date&&this.form.end_date<this.form.start_date)||(this.form.kind!=='savings'&&!this.form.category_id)) {this.formError='Başlık, pozitif tutar, tekrar süresi, tarih ve kategori alanlarını kontrol et.';return;}
    if(this.saving)return;this.saving=true;this.formError='';
    const endDate=this.form.frequency==='monthly'?(this.repeatMonths?this.monthlyEndDate(this.repeatMonths):null):(this.form.end_date||null);
    this.mutations.add(this.api.savePlan({...this.form,amount,end_date:endDate},this.editingId).subscribe({
      next:()=>{this.saving=false;this.showForm=false;this.finance.error='';this.finance.notice='Takvim planı kaydedildi. Gerçek gelir/gider kaydı oluşturulmadı.';this.reload();},
      error: response=>{this.saving=false;this.formError=response.error?.error||'Plan kaydedilemedi.';},
    }));
  }
  askArchive(plan: CalendarPlan): void {this.deleteTarget=plan;this.actionError='';this.focusRegion('delete-plan-title');}
  archivePlan(): void {
    if(!this.deleteTarget||this.actionBusy)return;
    this.actionBusy=true;this.actionError='';
    this.mutations.add(this.api.archivePlan(Number(this.deleteTarget.id)).subscribe({next:()=>{this.actionBusy=false;this.deleteTarget=null;this.finance.notice='Gelecek plan kaldırıldı; kayıtlı işlemler ve gerçekleşme geçmişi korundu.';this.reload();},error: response=>{this.actionBusy=false;this.actionError=response.error?.error||'Plan kaldırılamadı.';this.finance.error=this.actionError;}}));
  }
  applyBulkPlanChanges():void {
    const ids=[...this.selectedPlanIds];
    if(!ids.length||(!this.bulkCategoryId&&this.bulkFixed==='unchanged'))return;
    this.actionBusy=true;this.actionError='';
    this.mutations.add(this.api.updatePlans(ids,{...(this.bulkCategoryId?{category_id:this.bulkCategoryId}:{}),...(this.bulkFixed==='unchanged'?{}:{is_fixed:this.bulkFixed==='true'})}).subscribe({
      next:response=>{this.actionBusy=false;this.selectedPlanIds.clear();this.bulkCategoryId=null;this.bulkFixed='unchanged';this.finance.notice=`${response.updated} plan topluca güncellendi.`;this.reload();},
      error:response=>{this.actionBusy=false;this.actionError=response.error?.error||'Seçili planlar güncellenemedi.';},
    }));
  }
  openLink(item: CalendarOccurrence): void {this.linkTarget=item;this.linkTransaction=item.candidateTransactionIds[0]||null;this.linkSearch='';this.actionError='';this.focusRegion('calendar-link-transaction');}
  mark(item: CalendarOccurrence,action:'link'|'reserve'|'skip'): void {
    if(this.actionBusy || (action==='link'&&!this.linkTransaction))return;
    this.actionBusy=true;this.actionError='';
    this.mutations.add(this.api.markOccurrence(item.plan_id,item.occurrence_date,action,this.linkTransaction||undefined).subscribe({next: response=>{this.actionBusy=false;this.linkTarget=null;this.finance.error='';this.finance.notice=response.message;this.reload();},error: response=>{this.actionBusy=false;this.actionError=response.error?.error||'Plan işaretlenemedi.';this.finance.error=this.actionError;}}));
  }
  undo(item: CalendarOccurrence): void {
    if(this.actionBusy)return;this.actionBusy=true;this.actionError='';
    this.mutations.add(this.api.undoOccurrence(item.plan_id,item.occurrence_date).subscribe({next:()=>{this.actionBusy=false;this.finance.notice='İşaretleme kaldırıldı. Bağlı gerçek işlem silinmedi.';this.reload();},error: response=>{this.actionBusy=false;this.actionError=response.error?.error||'İşaretleme kaldırılamadı.';this.finance.error=this.actionError;}}));
  }
  dismiss(fingerprint:string): void {
    this.mutations.add(this.api.dismissAlert(fingerprint).subscribe({next:()=>{if(this.projection)this.projection.alerts=this.projection.alerts.filter(item=>item.fingerprint!==fingerprint);},error:()=>this.finance.error='Uyarı tercihi kaydedilemedi.'}));
  }
  private focusRegion(id: string): void {setTimeout(()=>{const element=document.getElementById(id);element?.scrollIntoView({block:'center'});element?.focus({preventScroll:true});},0);}
  private emptyForm(): CalendarPlanInput {this.repeatMonths=12;return {title:'',type:'Expense',kind:'planned_expense',amount:0,category_id:null,frequency:'none',start_date:this.today,end_date:null,is_fixed:false};}
}
