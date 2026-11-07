import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { FinanceStoreService } from './core/services/finance-store.service';
import { FinanceFormatService } from './core/services/finance-format.service';

function flushPageReads(http: HttpTestingController): void {
  http.match(request => request.method === 'GET').forEach(request => {
    if (request.request.url === '/api/categories') request.flush([
      { id: 1, name: 'Market', type: 'Expense', color: '#8b5cf6', icon: 'basket', is_default: 1, is_preferred: 1 },
      { id: 2, name: 'Maaş', type: 'Income', color: '#10b981', icon: 'briefcase', is_default: 1, is_preferred: 1 },
      { id: 3, name: 'Evcil hayvan', type: 'Expense', color: '#f59e0b', icon: 'paw', is_default: 0, is_preferred: 0 },
    ]);
    else if (request.request.url === '/api/exchange-rates/currencies') request.flush({ effectiveDate: '2026-11-02', currencies: ['EUR', 'USD'] });
    else if (request.request.url.startsWith('/api/exchange-rates?')) {
      const params = new URLSearchParams(request.request.url.split('?')[1]);
      request.flush({ currency: params.get('currency'), rate: 35, unit: 1, effectiveDate: params.get('date'), source: 'TCMB', basis: 'BanknoteBuying' });
    }
    else if (request.request.url === '/api/transactions') request.flush([]);
    else if (request.request.url === '/api/dashboard/summary') request.flush({ balance: 0, income: 0, expense: 0, monthIncome: 0, monthExpense: 0, previousMonthIncome: 0, previousMonthExpense: 0, recent: [], categories: [] });
    else if (request.request.url.startsWith('/api/reports/monthly')) request.flush([]);
    else if (request.request.url === '/api/settings') request.flush({ currency: 'TRY', theme: 'light', language: 'tr', allowDuplicateImports: false });
    else request.flush({});
  });
}
function initializeSignedIn(fixture: ComponentFixture<AppComponent>, http: HttpTestingController): void {
  fixture.detectChanges();
  http.expectOne('/api/auth/config').flush({ googleClientId: null });
  http.expectOne('/api/auth/me').flush({ user: { id: 1, email: 'ceren@example.com', name: 'Ceren Kurucu' } });
  http.expectOne('/api/settings').flush({ currency: 'TRY', theme: 'light', language: 'tr', allowDuplicateImports: false });
  flushPageReads(http);
  fixture.detectChanges();
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] }).compileComponents();
  });

  it('renders the Turkish Denge finance dashboard', () => {
    const fixture = TestBed.createComponent(AppComponent);
    initializeSignedIn(fixture, TestBed.inject(HttpTestingController));
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('Denge');
    expect(compiled.querySelector('h1')?.textContent).toContain('Ceren');
    expect(compiled.querySelector('nav')?.textContent).toContain('İşlemler');
  });

  it('opens transaction and category forms from their visible buttons', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    initializeSignedIn(fixture, TestBed.inject(HttpTestingController));
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('.topbar .quick-add')!.click();
    flushPageReads(TestBed.inject(HttpTestingController));
    fixture.detectChanges();
    expect(root.querySelector('.modal-card')).not.toBeNull();
    for (const currency of ['EUR', 'USD', 'GBP']) {
      expect(root.querySelector(`#transaction-currency option[value="${currency}"]`)).not.toBeNull();
    }

    TestBed.inject(FinanceStoreService).transactionModal = false;
    component.setPage('categories');
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.welcome-row .quick-add')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.small-modal')).not.toBeNull();
    expect(root.querySelector('#category-icon option[value="paw"]')).not.toBeNull();
  });

  it('preselects the preferred category when opening a transaction and changing its type', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);

    finance.openNewTransaction();
    flushPageReads(http);
    expect(finance.transactionForm.category_id).toBe(1);
    finance.setTransactionType('Income');
    expect(finance.transactionForm.category_id).toBe(2);
  });

  it('filters transactions and report totals by inclusive date range', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);
    finance.transactions = [
      { id: 1, type: 'Income', amount: 10000, original_amount: 10000, currency_code: 'TRY', exchange_rate: 1, tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description: 'Mayıs maaşı', category_id: 2, category: 'Maaş', category_color: '#10b981', transaction_date: '2026-05-05' },
      { id: 2, type: 'Expense', amount: 2500, original_amount: 2500, currency_code: 'TRY', exchange_rate: 1, tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description: 'Mayıs market', category_id: 1, category: 'Market', category_color: '#8b5cf6', transaction_date: '2026-05-08' },
      { id: 3, type: 'Expense', amount: 1500, original_amount: 1500, currency_code: 'TRY', exchange_rate: 1, tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description: 'Haziran ulaşım', category_id: 4, category: 'Ulaşım', category_color: '#f59e0b', transaction_date: '2026-06-04' },
    ];

    finance.transactionFrom = '2026-06-01';
    finance.transactionTo = '2026-06-30';
    expect(finance.visibleTransactions.map(item => item.id)).toEqual([3]);

    finance.reportFrom = '2026-05-01';
    finance.reportTo = '2026-05-31';
    expect(finance.reportIncome).toBe(10000);
    expect(finance.reportExpense).toBe(2500);
    expect(finance.reportSavings).toBe(7500);
    expect(finance.reportCategories.map(category => category.name)).toEqual(['Market']);
  });

  it('updates the selected default category after the API saves it', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);
    const preferred = { id: 3, name: 'Evcil hayvan', type: 'Expense' as const, color: '#f59e0b', icon: 'paw', is_default: 0, is_preferred: 1 };

    finance.setPreferredCategory(preferred);
    const update = http.expectOne('/api/categories/3/preferred');
    expect(update.request.method).toBe('PUT');
    update.flush(preferred);

    expect(finance.categories.find(category => category.id === 1)?.is_preferred).toBe(0);
    expect(finance.categories.find(category => category.id === 3)?.is_preferred).toBe(1);
  });

  it('formats Turkish lira amounts with comma decimals', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(TestBed.inject(FinanceFormatService).formatAmount(123456)).toContain('1.234,56');
  });

  it('reverts the theme and reports an error when saving the preference fails', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);

    finance.toggleTheme();
    expect(finance.dark).toBeTrue();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    http.expectOne('/api/settings').flush({ error: 'Database unavailable' }, { status: 503, statusText: 'Service Unavailable' });

    expect(finance.dark).toBeFalse();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(finance.error).toBe('Database unavailable');
  });

  it('converts numeric and text decimal inputs to kuruş without floating-point rounding', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const format = TestBed.inject(FinanceFormatService);
    expect(format.toCents('1.01')).toBe(101);
    expect(format.toCents(1.01)).toBe(101);
    expect(format.toCents('1,5')).toBe(150);
    expect(format.toCents('1.005')).toBeNull();
  });

  it('converts foreign-currency minor units with exact integer arithmetic', () => {
    const format = TestBed.inject(FinanceFormatService);
    expect(format.convertMinor(12_345, '32.5000000000')).toBe(401_213);
    expect(format.convertMinor(10_000, '0.285')).toBe(2_850);
    expect(format.toMinorUnits('125', 'JPY')).toBe(125);
    expect(format.toMinorUnits('125.5', 'JPY')).toBeNull();
    expect(format.toMinorUnits('12.345', 'KWD')).toBe(12345);
    expect(format.convertCurrencyMinor(100, '0.285', 'JPY')).toBe(2850);
    expect(format.formatCurrency(1234, 'USD')).toContain('12,34');
    expect(format.formatRate(40.5)).toBe('40,50');
  });

  it('posts a numeric transaction amount as integer kuruş and refreshes data', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);
    finance.transactionForm = { type: 'Expense', amount: 1.01, currency_code: 'TRY', exchange_rate: 1, tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description: 'Test market işlemi', category_id: 1, transaction_date: '2026-11-01' };
    finance.transactionModal = true;
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('form.modal-card')!;
    const setField = (selector: string, value: string) => {
      const field = form.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
      field.value = value;
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    setField('#transaction-amount', '1.01');
    setField('#transaction-description', 'Test market işlemi');
    const category = form.querySelector<HTMLSelectElement>('#transaction-category')!;
    category.selectedIndex = 1;
    category.dispatchEvent(new Event('change', { bubbles: true }));
    setField('#transaction-date', '2026-11-01');
    fixture.detectChanges();
    const invalidFields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      .filter(field => !field.checkValidity())
      .map(field => `${field.name}: ${field.value || '(empty)'}`);
    expect(invalidFields).withContext('invalid transaction fields').toEqual([]);
    form.querySelector<HTMLButtonElement>('.quick-add')!.click();
    expect(finance.modalError).withContext('transaction form validation').toBe('');

    const create = http.expectOne('/api/transactions');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(jasmine.objectContaining({ amount: 101, category_id: 1, description: 'Test market işlemi', type: 'Expense' }));
    create.flush({ id: 9 });
    flushPageReads(http);
    expect(finance.transactionModal).toBeFalse();
    expect(finance.notice).toBe('İşlem eklendi.');
  });

  it('posts a new income category and refreshes data', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);
    finance.categoryForm = { id: 0, name: 'Ek ders', type: 'Income', color: '#35644c', icon: 'circle' };
    finance.categoryModal = true;
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('form.small-modal')!;
    const name = form.querySelector<HTMLInputElement>('#category-name')!;
    name.value = 'Ek ders';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(form.checkValidity()).toBeTrue();
    form.querySelector<HTMLButtonElement>('.quick-add')!.click();

    const create = http.expectOne('/api/categories');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'Ek ders', type: 'Income', color: '#35644c', icon: 'circle' });
    create.flush({ id: 16 });
    flushPageReads(http);
    expect(finance.categoryModal).toBeFalse();
  });

  it('sends transaction deletion only after the in-app confirmation', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);
    finance.deletePrompt = { kind: 'transaction', id: 2, label: 'Market' };
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.delete-confirm')!.click();

    const deletion = http.expectOne('/api/transactions/2');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    flushPageReads(http);
    expect(finance.deletePrompt).toBeNull();
    expect(finance.notice).toBe('İşlem silindi.');
  });

  it('does not load financial data before the user signs in', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/auth/config').flush({ googleClientId: null });
    http.expectOne('/api/auth/me').flush({ error: 'Giriş gerekli.' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.auth-screen')).not.toBeNull();
    expect(root.querySelector('.app-shell')).toBeNull();
    http.expectNone(request => request.url === '/api/transactions' || request.url === '/api/categories');
  });

  it('clears private data from the UI when the user signs out', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    initializeSignedIn(fixture, http);
    const finance = TestBed.inject(FinanceStoreService);
    finance.transactions = [{ id: 1, type: 'Expense', amount: 100, original_amount: 100, currency_code: 'TRY', exchange_rate: 1, tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description: 'Gizli kayıt', category_id: 1, category: 'Market', category_color: '#8b5cf6', transaction_date: '2026-11-01' }];
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.logout-button')!.click();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(component.user).toBeNull();
    expect(finance.transactions).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.auth-screen')).not.toBeNull();
  });
});
