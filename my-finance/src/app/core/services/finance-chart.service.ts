import { Injectable } from '@angular/core';
import type { Chart, ChartConfiguration } from 'chart.js';
import { DashboardCategory, MonthlyReport } from '../models/finance.models';
import { FinanceFormatService } from './finance-format.service';

type ChartKey = 'flow' | 'category' | 'report';

@Injectable({ providedIn: 'root' })
export class FinanceChartService {
  private readonly charts: Partial<Record<ChartKey, Chart<any, any, any>>> = {};
  private readonly signatures: Partial<Record<ChartKey, string>> = {};
  private registered = false;

  syncMonthly(key: 'flow' | 'report', canvas: HTMLCanvasElement | undefined, data: MonthlyReport[], format: FinanceFormatService): void {
    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: data.map(item => format.monthName(item.month)),
        datasets: [
          { label: 'Gelir', data: data.map(item => item.income / 100), backgroundColor: '#8071e5', borderRadius: 4, borderSkipped: false, barPercentage: .66, categoryPercentage: .68 },
          { label: 'Gider', data: data.map(item => item.expense / 100), backgroundColor: '#c1baf3', borderRadius: 4, borderSkipped: false, barPercentage: .66, categoryPercentage: .68 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${format.money.format(Number(context.raw))}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#9694a3', font: { size: 9 } } },
          y: { beginAtZero: true, grid: { color: '#eeedf2' }, ticks: { color: '#9694a3', font: { size: 8 }, callback: value => format.money.format(Number(value)) } },
        },
      },
    };
    this.sync(key, canvas, data, config);
  }

  syncCategories(canvas: HTMLCanvasElement | undefined, data: DashboardCategory[], format: FinanceFormatService): void {
    const config: ChartConfiguration<'doughnut', number[], string> = {
      type: 'doughnut',
      data: {
        labels: data.map(item => item.name),
        datasets: [{ data: data.map(item => item.amount / 100), backgroundColor: data.map(item => item.color), borderWidth: 0, hoverOffset: 5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '76%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${format.money.format(Number(context.raw))}` } } },
      },
    };
    this.sync('category', canvas, data, config);
  }

  destroy(key: ChartKey): void {
    this.charts[key]?.destroy();
    delete this.charts[key];
    delete this.signatures[key];
  }

  private sync(key: ChartKey, canvas: HTMLCanvasElement | undefined, data: unknown, config: ChartConfiguration<any, any, any>): void {
    if (!canvas) { this.destroy(key); return; }
    const signature = JSON.stringify(data);
    if (signature === this.signatures[key]) return;
    this.signatures[key] = signature;
    void import('chart.js').then(({ ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, LinearScale, Tooltip }) => {
      if (!canvas.isConnected || this.signatures[key] !== signature) return;
      if (!this.registered) {
        Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, LinearScale, Tooltip);
        this.registered = true;
      }
      this.charts[key]?.destroy();
      this.charts[key] = new Chart(canvas, config);
    }).catch(() => {
      delete this.signatures[key];
    });
  }
}
