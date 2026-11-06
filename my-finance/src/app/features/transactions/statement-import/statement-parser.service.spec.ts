import { extractPdfTableRows, StatementParserService } from './statement-parser.service';

describe('StatementParserService', () => {
  let parser: StatementParserService;

  beforeEach(() => parser = new StatementParserService());

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
