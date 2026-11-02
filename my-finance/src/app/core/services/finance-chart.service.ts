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
    const dark = document.documentElement.dataset['theme'] === 'dark';
    const rootStyle = getComputedStyle(document.documentElement);
    const incomeColor = rootStyle.getPropertyValue('--accent').trim();
    const expenseColor = rootStyle.getPropertyValue('--lime').trim();
    const gridColor = rootStyle.getPropertyValue('--line').trim();
    const tickColor = rootStyle.getPropertyValue('--muted').trim();
    const surfaceColor = rootStyle.getPropertyValue('--surface').trim();
    const inkColor = rootStyle.getPropertyValue('--ink').trim();
    const chartColor = (color: string) => (context: { chart: Chart }) => {
      const { chart } = context;
      const { ctx, chartArea } = chart;
      if (!chartArea) return color;
      const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
      gradient.addColorStop(0, this.withAlpha(color, .9));
      gradient.addColorStop(1, color);
      return gradient;
    };
    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: data.map(item => format.monthName(item.month)),
        datasets: [
          { label: 'Gelir', data: data.map(item => item.income / 100), backgroundColor: chartColor(incomeColor), hoverBackgroundColor: incomeColor, borderRadius: 9, borderSkipped: false, barPercentage: .98, categoryPercentage: .98, maxBarThickness: 42 },
          { label: 'Gider', data: data.map(item => item.expense / 100), backgroundColor: chartColor(expenseColor), hoverBackgroundColor: expenseColor, borderRadius: 9, borderSkipped: false, barPercentage: .98, categoryPercentage: .98, maxBarThickness: 42 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 650, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8, right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: surfaceColor, titleColor: inkColor, bodyColor: tickColor,
            borderColor: gridColor, borderWidth: 1, cornerRadius: 10, padding: 12,
            displayColors: true, boxPadding: 5, usePointStyle: true,
            titleFont: { size: 12, weight: 650 }, bodyFont: { size: 12 },
            callbacks: { label: context => ` ${context.dataset.label}: ${format.money.format(Number(context.raw))}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: tickColor, padding: 8, font: { size: 10, weight: 550 } } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: gridColor, drawTicks: false }, ticks: { color: tickColor, padding: 10, maxTicksLimit: 5, font: { size: 9 }, callback: value => format.money.format(Number(value)) } },
        },
      },
    };
    this.sync(key, canvas, { data, dark }, config);
  }

  syncCategories(canvas: HTMLCanvasElement | undefined, data: DashboardCategory[], format: FinanceFormatService): void {
    const rootStyle = getComputedStyle(document.documentElement);
    const surfaceColor = rootStyle.getPropertyValue('--surface').trim();
    const inkColor = rootStyle.getPropertyValue('--ink').trim();
    const tickColor = rootStyle.getPropertyValue('--muted').trim();
    const gridColor = rootStyle.getPropertyValue('--line').trim();
    const dark = document.documentElement.dataset['theme'] === 'dark';
    const config: ChartConfiguration<'doughnut', number[], string> = {
      type: 'doughnut',
      data: {
        labels: data.map(item => item.name),
        datasets: [{ data: data.map(item => item.amount / 100), backgroundColor: data.map(item => item.color), borderColor: surfaceColor, borderWidth: 3, borderRadius: 5, spacing: 2, hoverOffset: 7 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        animation: { animateRotate: true, animateScale: true, duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: surfaceColor, titleColor: inkColor, bodyColor: tickColor,
            borderColor: gridColor, borderWidth: 1, cornerRadius: 10, padding: 12,
            displayColors: true, boxPadding: 5, usePointStyle: true,
            titleFont: { size: 12, weight: 650 }, bodyFont: { size: 12 },
            callbacks: { label: context => ` ${format.money.format(Number(context.raw))}` },
          },
        },
      },
    };
    this.sync('category', canvas, { data, dark }, config);
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

  private withAlpha(color: string, alpha: number): string {
    const hex = color.replace('#', '');
    if (/^[\da-f]{3}$/i.test(hex)) {
      const [r, g, b] = hex.split('').map(value => parseInt(value + value, 16));
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (/^[\da-f]{6}$/i.test(hex)) {
      const value = Number.parseInt(hex, 16);
      return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
    }
    return color;
  }
}
