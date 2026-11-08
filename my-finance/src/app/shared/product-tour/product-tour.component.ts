import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FinancePage } from '../../core/models/finance.models';

interface TourStep { page: FinancePage; eyebrow: string; title: string; body: string; action: string; }
@Component({selector:'app-product-tour',standalone:true,imports:[CommonModule],templateUrl:'./product-tour.component.html',styleUrl:'./product-tour.component.scss',changeDetection:ChangeDetectionStrategy.OnPush})
export class ProductTourComponent {
  @Input() page:FinancePage='dashboard';
  @Output() pageChange=new EventEmitter<FinancePage>();
  @Output() close=new EventEmitter<void>();
  readonly steps:TourStep[]=[
    {page:'dashboard',eyebrow:'01 · GENEL BAKIŞ',title:'Finansal durumun tek ekranda',body:'Bakiye, gelir-gider özeti ve son hareketleri buradan takip et. Bakiye yalnızca gerçekleşmiş işlem kayıtlarından hesaplanır.',action:'İşlemlere geç'},
    {page:'transactions',eyebrow:'02 · İŞLEMLER',title:'Gerçekleşen hareketlerini kaydet',body:'Gelir ve gider ekleyebilir, düzenleyebilir, filtreleyebilir veya ekstreyi önizleyerek içe aktarabilirsin.',action:'Planlara geç'},
    {page:'plans',eyebrow:'03 · PLANLAR',title:'Geleceği gerçekleşmişten ayrı tut',body:'Tekrarlayan ödemeleri ve beklenen gelirleri planla. Bir plan gerçek işlemle eşleştiğinde çift sayımı önle.',action:'Takvime geç'},
    {page:'calendar',eyebrow:'04 · TAKVİM',title:'Tarihleri ve tekrarları gör',body:'Maaş, kira, faturalar ve diğer planları takvimde düzenle; yaklaşan ödemeleri tarih sırasıyla incele.',action:'Nakit akışına geç'},
    {page:'cashflow',eyebrow:'05 · NAKİT AKIŞI',title:'Beklenen bakiyeyi değerlendir',body:'7, 30 veya 90 günlük dönemde bugünkü kayıtlı bakiye ile tarihli planları karşılaştır. Tahminler gerçekleşmiş para değildir.',action:'Raporlara geç'},
    {page:'reports',eyebrow:'06 · RAPORLAR',title:'Dönemini seç, eğilimi incele',body:'Gerçekleşmiş gelir ve giderleri tarih aralığı, ay ve kategori bazında analiz et; raporu CSV olarak al.',action:'Turu bitir'},
  ];
  index=0;
  get step():TourStep{return this.steps[this.index];}
  ngOnInit():void{const found=this.steps.findIndex(step=>step.page===this.page);if(found>=0)this.index=found;this.pageChange.emit(this.step.page);}
  next():void{if(this.index>=this.steps.length-1){this.close.emit();return;}this.index++;this.pageChange.emit(this.step.page);}
  back():void{if(this.index>0){this.index--;this.pageChange.emit(this.step.page);}}
  closeTour():void{this.close.emit();}
}
