import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });

  it('renders the Turkish Denge finance dashboard', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('Denge');
    expect(compiled.querySelector('h1')?.textContent).toContain('Merhaba, Ceren');
    expect(compiled.querySelector('nav')?.textContent).toContain('İşlemler');
  });

  it('formats Turkish lira amounts with comma decimals', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(component.fmt(123456)).toContain('1.234,56');
  });

  it('converts decimal amounts to kuruş without floating-point rounding', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(component.toCents('1.01')).toBe(101);
    expect(component.toCents(1.01)).toBe(101);
    expect(component.toCents('1,5')).toBe(150);
    expect(component.toCents('1.005')).toBeNull();
  });

  it('sends the numeric value from a number input to the API as integer kuruş', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    component.form = { type: 'Expense', amount: 1.01, description: 'Market', category_id: 1, transaction_date: '2026-11-01' };
    component.modal = true;

    component.save();

    const create = http.expectOne('/api/transactions');
    expect(create.request.method).toBe('POST');
    expect(create.request.body.amount).toBe(101);
    create.flush({ id: 1 });

    http.match(request => request.method === 'GET').forEach(request => {
      if (request.request.url === '/api/categories') request.flush([]);
      else if (request.request.url === '/api/transactions') request.flush([]);
      else if (request.request.url === '/api/dashboard/summary') request.flush({ balance: 0, income: 0, expense: 0, monthIncome: 0, monthExpense: 0, previousMonthIncome: 0, previousMonthExpense: 0, recent: [], categories: [] });
      else request.flush([]);
    });
    expect(component.modal).toBeFalse();
  });
});
