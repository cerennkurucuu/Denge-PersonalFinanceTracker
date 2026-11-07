import { extractPdfTableRows, StatementParserService } from './statement-parser.service';

describe('StatementParserService', () => {
  let parser: StatementParserService;

  beforeEach(() => parser = new StatementParserService());

  it('identifies the source line of an unclosed CSV quote', async () => {
    const file=new File(['Tarih;Açıklama;Tutar\n06.11.2026;"Kapanmayan alan;10,00\n'],'broken.csv',{type:'text/csv'});
    await expectAsync(parser.parse(file)).toBeRejectedWithError(/Satır 2.*çift tırnak/);
  });

  it('recognizes Turkish capital İ in İşlem Tutarı and preserves source row numbers including blanks', async () => {
    const file=new File([',,,,\n,,,,\nTarih,Fiş No,Açıklama,İşlem Tutarı,Bakiye\n06.11.2026,123,Market,"-8,37","100,00"\nbozuk,124,Market,"-9,50","90,50"\nwww.banka.example,,,,\n'],'headers.csv',{type:'text/csv'});
    const result=await parser.parse(file);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].sourceRow).toBe(4);
    expect(result.rows[0].originalAmount).toBe(837);
    expect(result.rows[1].error).toContain('Satır 5 · Tarih');
    expect(result.warnings.join(' ')).toContain('6');
  });

  it('reads raw Excel values with a nonstandard display format without labeling the workbook corrupt', async () => {
    const X=await import('xlsx');
    const sheet=X.utils.aoa_to_sheet([['Tarih','Açıklama','İşlem Tutarı','Bakiye'],[46332,'Market',-8.37,100]]);
    sheet['C2'].z='#,##0.##';
    const book=X.utils.book_new();X.utils.book_append_sheet(book,sheet,'Hareketler');
    const file=new File([X.write(book,{type:'array',bookType:'xlsx'})],'format.xlsx');
    const result=await parser.parse(file);
    expect(result.rows[0].originalAmount).toBe(837);
    expect(result.rows[0].transaction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects dates in amount cells and ambiguous headerless date/amount/balance rows', async () => {
    expect(parser.parseAmountInput('31.10.2026', 'TRY')).toBeNull();
    const file = new File(['31.10.2026;Market;125,00;875,00\n'], 'unknown.csv', { type: 'text/csv' });
    await expectAsync(parser.parse(file)).toBeRejected();
  });

  it('parses Turkish CSV amounts, directions, dates and removes long account numbers', async () => {
    const file = new File([
      'Tarih;Açıklama;Tutar;Para Birimi;Yön;İşyeri\n'
      + '05.11.2026;MIGROS MARKET hesap 1234567890;1.234,50;TRY;Borç;Migros\n'
      + '06.11.2026;Aylık maaş;45.000,00;TRY;Alacak;İşveren\n',
    ], 'ekstre.csv', { type: 'text/csv' });

    const result = await parser.parse(file);
    expect(result.format).toBe('CSV');
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].transaction_date).toBe('2026-11-05');
    expect(result.rows[0].originalAmount).toBe(123450);
    expect(result.rows[0].type).toBe('Expense');
    expect(result.rows[0].description).not.toContain('1234567890');
    expect(result.rows[1].originalAmount).toBe(4_500_000);
    expect(result.rows[1].type).toBe('Income');
  });

  it('maps an Etiket column into the editable category field', async () => {
    const file = new File([
      'Tarih;Açıklama;Etiket;Tutar;Bakiye\n'
      + '05.11.2026;Market alışverişi;Market;1.234,50;8.765,50\n',
    ], 'ekstre.csv', { type: 'text/csv' });
    const result = await parser.parse(file);
    expect(result.rows[0].category_name).toBe('Market');
    expect(result.rows[0].originalAmount).toBe(123450);
  });

  it('treats a leading minus as an expense and keeps its absolute minor-unit amount', async () => {
    const file = new File([
      'Tarih;Açıklama;Tutar;Kategori\n'
      + '05.11.2026;Market;-8,37 TL;Market\n'
      + '06.11.2026;Ulaşım;-12,50 TL;Ulaşım\n',
    ], 'eksi-tutar.csv', { type: 'text/csv' });
    const result = await parser.parse(file);
    expect(result.rows[0].type).toBe('Expense');
    expect(result.rows[0].originalAmount).toBe(837);
    expect(result.rows[0].isNegativeAmount).toBeTrue();
    expect(parser.parseAmountInput('-8,37 TL', 'TRY')).toBe(837);
    expect(result.rows[1].type).toBe('Expense');
    expect(result.rows[1].originalAmount).toBe(1250);
  });

  it('treats a positive signed amount as income without mistaking “ödeme” in its description for an expense', async () => {
    const file = new File([
      'Tarih;Açıklama;Tutar;Para Birimi\n'
      + '05.11.2026;HARCIRAH ÖDEMESİ;4.200,00;TRY\n',
    ], 'gelir.csv', { type: 'text/csv' });
    const result = await parser.parse(file);

    expect(result.rows[0].type).toBe('Income');
    expect(result.rows[0].originalAmount).toBe(420000);
    expect(result.rows[0].needsReview).toBeFalse();
  });

  it('extracts only PDF transaction-table columns and ignores the balance column', () => {
    const result = extractPdfTableRows([[
      { y: 100, items: [
        { x: 31, text: 'Tarih' }, { x: 88, text: 'Açıklama' }, { x: 315, text: 'Etiket' },
        { x: 460, text: 'Tutar' }, { x: 541, text: 'Bakiye' },
      ] },
      { y: 80, items: [
        { x: 31, text: '05.11.2026' }, { x: 88, text: 'Market alışverişi' }, { x: 315, text: 'Market' },
        { x: 460, text: '-1.234,50 TL' }, { x: 541, text: '8.765,50 TL' },
      ] },
      { y: 40, items: [{ x: 31, text: '06.11.2026' }, { x: 460, text: '9.999,00' }] },
    ]]);
    expect(result.foundTable).toBeTrue();
    expect(result.rows).toEqual([
      ['Tarih', 'Açıklama', 'Kategori', 'Tutar'],
      ['05.11.2026', 'Market alışverişi', 'Market', '-1.234,50 TL'],
    ]);
    expect(result.missedRows).toBe(1);
  });

  it('marks card payments and account transfers for exclusion from consumption spending', async () => {
    const file = new File([
      'Tarih,Açıklama,Tutar,Yön\n'
      + '05.11.2026,Kredi kartı borç ödeme,2500,Borç\n'
      + '05.11.2026,Kendi hesabıma havale,1500,Borç\n',
    ], 'hareketler.csv', { type: 'text/csv' });

    const result = await parser.parse(file);
    expect(result.rows[0].entry_kind).toBe('card_payment');
    expect(result.rows[1].entry_kind).toBe('transfer');
    expect(result.rows.every(row => row.excluded)).toBeTrue();
    expect(result.skipped).toBe(2);
  });

  it('rejects files whose extension and actual file signature do not match', async () => {
    const fake = new File(['not an xlsx'], 'bad.xlsx', { type: 'application/octet-stream' });
    await expectAsync(parser.parse(fake)).toBeRejectedWithError(/imzası doğrulanamadı/);
  });

  it('refuses unsupported image based PDFs with an actionable message', async () => {
    const fake = new File(['%PDF-1.7\n%%EOF'], 'scan.pdf', { type: 'application/pdf' });
    await expectAsync(parser.parse(fake)).toBeRejectedWithError(/PDF okunamadı|metin katmanı/);
  });
});
