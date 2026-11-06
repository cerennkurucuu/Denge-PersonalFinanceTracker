import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FinanceApiService } from '../../../core/services/finance-api.service';
import { FinanceFormatService } from '../../../core/services/finance-format.service';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { StatementImportComponent } from './statement-import.component';
import { ParsedStatement, ParsedStatementItem, StatementParserService } from './statement-parser.service';

describe('StatementImportComponent', () => {
  let fixture: ComponentFixture<StatementImportComponent>;
  let parserMock: jasmine.SpyObj<StatementParserService>;
  let storeMock: { categories: Array<{ id: number; name: string; type: 'Income' | 'Expense' }>; load: jasmine.Spy };

  beforeEach(async () => {
    parserMock = jasmine.createSpyObj<StatementParserService>('StatementParserService', ['parse', 'parseAmountInput']);
    parserMock.parse.and.rejectWith(new Error('test parse error'));
    storeMock = { categories: [], load: jasmine.createSpy('load') };
    await TestBed.configureTestingModule({
      imports: [StatementImportComponent],
      providers: [
        { provide: FinanceApiService, useValue: {} },
        { provide: FinanceFormatService, useValue: { formatAmount: (amount: number) => String(amount) } },
        { provide: FinanceStoreService, useValue: storeMock },
        { provide: StatementParserService, useValue: parserMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StatementImportComponent);
    fixture.detectChanges();
  });

  it('shows an operable native file input and drag-and-drop instructions', () => {
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;

    expect(input.disabled).toBeFalse();
    expect(input.accept).toContain('.pdf');
    expect(input.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(input).display).not.toBe('none');
    expect(fixture.nativeElement.textContent).toContain('veya dosyanı buraya sürükleyip bırak');
  });

  it('parses a file selected from the native picker change event', async () => {
    const component = fixture.componentInstance;
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['sample'], 'sample.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();

    expect(parserMock.parse).toHaveBeenCalledOnceWith(file);
    expect(component.error).toBe('test parse error');
    expect(component.loading).toBeFalse();
  });

  it('sends a dropped file through the same parser as file selection', async () => {
    const component = fixture.componentInstance;
    const file = new File(['sample'], 'sample.csv', { type: 'text/csv' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });

    component.fileDropped(event);
    await fixture.whenStable();

    expect(event.defaultPrevented).toBeTrue();
    expect(parserMock.parse).toHaveBeenCalledOnceWith(file);
    expect(component.error).toBe('test parse error');
    expect(component.loading).toBeFalse();
  });

  it('applies one chosen direction and category to all included rows and makes valid rows saveable', () => {
    const component = fixture.componentInstance;
    storeMock.categories = [{ id: 7, name: 'Market', type: 'Expense' }];
    const row = {
      sourceRow: 2, transaction_date: '2026-11-05', description: 'Market alışverişi', merchant_name: '', originalAmount: 12500,
      isNegativeAmount: true, currency_code: 'TRY', type: 'Expense', entry_kind: 'standard', confidence: 'low', needsReview: true, reference: '',
      excluded: false, error: 'Gelir/gider yönünü onayla.', amountText: '-125,00', amount: 12500, exchange_rate: 1,
      tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, category_id: null, category_name: null,
      duplicateKind: null, duplicateDescription: '', confirmPotentialDuplicate: false, learnMerchant: false,
    } as ParsedStatementItem;
    component.statement = { fileName: 'ekstre.csv', fileSha256: 'a'.repeat(64), rows: [row], warnings: [], skipped: 0, format: 'CSV' } satisfies ParsedStatement;
    component.setBulkType('Expense');
    component.bulkCategoryId = 7;
    component.applyBulkClassification();

    expect(row.type).toBe('Expense');
    expect(row.category_id).toBe(7);
    expect(component.isValid(row)).toBeTrue();
    expect(component.canImport()).toBeTrue();
  });
});
