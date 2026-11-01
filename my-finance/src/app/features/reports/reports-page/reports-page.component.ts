import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, AfterViewChecked, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinanceChartService } from '../../../core/services/finance-chart.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';

@Component({ selector: 'app-reports-page', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './reports-page.component.html', styleUrl: './reports-page.component.scss' })
export class ReportsPageComponent implements AfterViewChecked, OnDestroy {
  readonly finance=inject(FinanceStoreService); readonly format=inject(FinanceFormatService); private readonly charts=inject(FinanceChartService);
  readonly availableYears=Array.from({length:6},(_,index)=>new Date().getFullYear()-index);
  @ViewChild('reportChart') private chart?: ElementRef<HTMLCanvasElement>;
  ngAfterViewChecked():void { this.charts.syncMonthly('report',this.chart?.nativeElement,this.finance.monthly,this.format); }
  ngOnDestroy():void { this.charts.destroy('report'); }
  yearChanged():void { this.finance.loadMonthly(); }
  categoryShare(amount:number):number { const highest=this.finance.summary.categories[0]?.amount??0; return highest>0?Math.round(amount/highest*100):0; }
}
