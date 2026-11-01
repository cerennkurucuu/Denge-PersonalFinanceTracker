import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

function flushPageReads(http: HttpTestingController): void {
  http.match(request => request.method === 'GET').forEach(request => {
    if (request.request.url === '/api/categories') request.flush([{ id: 1, name: 'Market', type: 'Expense', color: '#8b5cf6', icon: 'basket', is_default: 1 }]);
    else if (request.request.url === '/api/transactions') request.flush([]);
    else if (request.request.url === '/api/dashboard/summary') request.flush({ balance: 0, income: 0, expense: 0, monthIncome: 0, monthExpense: 0, previousMonthIncome: 0, previousMonthExpense: 0, recent: [], categories: [] });
    else if (request.request.url.startsWith('/api/reports/monthly')) request.flush([]);
    else if (request.request.url === '/api/settings') request.flush({ currency: 'TRY', theme: 'light', language: 'tr' });
    else request.flush({});
  });
}

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

  it('opens transaction and category forms from their visible buttons', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('.topbar .quick-add')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.modal-card')).not.toBeNull();

    component.modal = false;
    component.setPage('categories');
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.welcome-row .quick-add')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.small-modal')).not.toBeNull();
  });

  it('formats Turkish lira amounts with comma decimals', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(component.fmt(123456)).toContain('1.234,56');
  });

  it('converts numeric and text decimal inputs to kuruş without floating-point rounding', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(component.toCents('1.01')).toBe(101);
    expect(component.toCents(1.01)).toBe(101);
    expect(component.toCents('1,5')).toBe(150);
    expect(component.toCents('1.005')).toBeNull();
  });

  it('posts a numeric transaction amount as integer kuruş and refreshes data', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    flushPageReads(http);
    component.form = { type: 'Expense', amount: 1.01, description: 'Test market işlemi', category_id: 1, transaction_date: '2026-11-01' };
    component.modal = true;
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.modal-card .quick-add')!.click();

    const create = http.expectOne('/api/transactions');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(jasmine.objectContaining({ amount: 101, category_id: 1, description: 'Test market işlemi', type: 'Expense' }));
    create.flush({ id: 9 });
    flushPageReads(http);
    expect(component.modal).toBeFalse();
    expect(component.notice).toBe('İşlem eklendi.');
  });

  it('posts a new income category and refreshes data', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    flushPageReads(http);
    component.categoryForm = { id: 0, name: 'Ek ders', type: 'Income', color: '#7c6cf2', icon: 'circle' };
    component.categoryModal = true;
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.small-modal .quick-add')!.click();

    const create = http.expectOne('/api/categories');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'Ek ders', type: 'Income', color: '#7c6cf2', icon: 'circle' });
    create.flush({ id: 16 });
    flushPageReads(http);
    expect(component.categoryModal).toBeFalse();
  });

  it('sends transaction deletion only after the in-app confirmation', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    flushPageReads(http);
    component.deletePrompt = { kind: 'transaction', id: 2, label: 'Market' };
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.delete-confirm')!.click();

    const deletion = http.expectOne('/api/transactions/2');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    flushPageReads(http);
    expect(component.deletePrompt).toBeNull();
    expect(component.notice).toBe('İşlem silindi.');
  });
});
