import { Injectable } from '@angular/core';
import type * as XLSXTypes from 'xlsx';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type StatementType = 'Income' | 'Expense';
export type StatementKind = 'standard' | 'refund' | 'transfer' | 'card_payment';

export interface ParsedStatementItem {
  sourceRow: number;
  transaction_date: string;
  description: string;
  merchant_name: string;
  originalAmount: number;
  isNegativeAmount: boolean;
  currency_code: string;
  type: StatementType;
  entry_kind: StatementKind;
  confidence: 'high' | 'medium' | 'low';
  needsReview: boolean;
  reference: string;
  excluded: boolean;
  error: string;
  amountText: string;
  amount: number;
  exchange_rate: number | string;
  tcmb_rate: number | null;
  rate_source: 'TRY' | 'TCMB' | 'manual';
  rate_effective_date: string | null;
  category_id: number | null;
  category_name: string | null;
  duplicateKind: 'exact' | 'possible' | null;
  duplicateDescription: string;
  confirmPotentialDuplicate: boolean;
  learnMerchant: boolean;
}

export interface ParsedStatement {
  fileName: string;
  fileSha256: string;
  rows: ParsedStatementItem[];
  warnings: string[];
  skipped: number;
  format: 'CSV' | 'XLS' | 'XLSX' | 'PDF';
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10000;
const PDF_MAX_PAGES = 100;
const CURRENCY_CODES = ['TRY', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'JPY', 'KWD', 'AUD', 'AED', 'CNY'] as const;
const CURRENCY_DIGITS = new Map<string, number>();
const DATE_HEADER = ['tarih', 'islem tarihi', 'transaction date', 'date', 'value date', 'valör'];
const DESCRIPTION_HEADER = ['aciklama', 'islem aciklamasi', 'description', 'merchant', 'is yeri', 'transaction', 'hareket'];
const AMOUNT_HEADER = ['tutar', 'amount', 'islem tutari', 'transaction amount'];
const DEBIT_HEADER = ['borc', 'debit', 'withdrawal', 'giden tutar'];
const CREDIT_HEADER = ['alacak', 'credit', 'deposit', 'gelen tutar'];
const CATEGORY_HEADER = ['kategori', 'category', 'etiket', 'tag'];
const BALANCE_HEADER = ['bakiye', 'balance', 'running balance', 'available balance'];
const CURRENCY_HEADER = ['para birimi', 'currency', 'doviz'];
const DIRECTION_HEADER = ['islem tipi', 'islem yonu', 'yon', 'direction', 'borc alacak', 'type'];
const MERCHANT_HEADER = ['isyeri', 'merchant name', 'merchant', 'terminal'];
const REFERENCE_HEADER = ['referans', 'reference', 'transaction id', 'islem no'];

function fold(value: unknown): string {
  return String(value ?? '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10);
  }
  const source = String(value ?? '').trim();
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(source);
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(source);
  const candidate = iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : local ? `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}` : '';
  if (!candidate) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
}

function currencyCode(value: unknown, amountText: string): string {
  const source = `${String(value ?? '')} ${amountText}`.toUpperCase();
  for (const code of CURRENCY_CODES) if (new RegExp(`\\b${code}\\b`).test(source)) return code;
  if (source.includes('€')) return 'EUR';
  if (source.includes('$')) return 'USD';
  if (source.includes('£')) return 'GBP';
  return 'TRY';
}

function parseAmount(value: unknown, preferredCurrency = 'TRY'): { minor: number | null; negative: boolean; currency: string; text: string } {
  const text = String(value ?? '').trim();
  if (!text) return { minor: null, negative: false, currency: 'TRY', text };
  if (/^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/.test(text)) return { minor: null, negative: false, currency: 'TRY', text };
  const negative = /^\s*(?:-|\()\s*\d/.test(text) || /\b(BORC|DEBIT|OUT)\b/i.test(text);
  const digits = text.replace(/\b(?:TRY|TL|USD|EUR|GBP|CAD|CHF|JPY|KWD|AUD|AED|CNY)\b/gi, '').replace(/[₺€$£\s()]/g, '').replace(/-/g, '');
  let normalized = digits;
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    normalized = normalized.replace(/[.,]/g, (char, index) => char === decimal && index === Math.max(comma, dot) ? '.' : '');
  } else if (comma >= 0) {
    const tail = normalized.length - comma - 1;
    normalized = tail <= 3 ? `${normalized.slice(0, comma).replace(/[.,]/g, '')}.${normalized.slice(comma + 1).replace(/[.,]/g, '')}` : normalized.replace(/,/g, '');
  } else if (dot >= 0) {
    const parts = normalized.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) normalized = parts.join('');
  }
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return { minor: null, negative, currency: currencyCode('', text), text };
  const code = currencyCode(preferredCurrency, text);
  if (!CURRENCY_DIGITS.has(code)) CURRENCY_DIGITS.set(code, new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2);
  const fractionDigits = CURRENCY_DIGITS.get(code)!;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > fractionDigits && /[1-9]/.test(fraction.slice(fractionDigits))) return { minor: null, negative, currency: code, text };
  const minor = Number(BigInt(whole) * (10n ** BigInt(fractionDigits)) + BigInt(fraction.slice(0, fractionDigits).padEnd(fractionDigits, '0') || '0'));
  return { minor: Number.isSafeInteger(minor) && minor > 0 ? minor : null, negative, currency: code, text };
}

function direction(value: unknown): StatementType | null {
  const normalized = fold(value);
  // “Ödeme” alone is ambiguous in Turkish bank descriptions: it can mean a
  // payment received (e.g. harcırah ödemesi), so do not treat it as debit.
  if (/\b(borc|debit|out|gider|withdrawal|harcama|cikis)\b/.test(normalized)) return 'Expense';
  if (/\b(alacak|credit|in|gelir|deposit|iade|refund|iptal|giris)\b/.test(normalized)) return 'Income';
  return null;
}

function classifyKind(description: string): StatementKind {
  const normalized = fold(description);
  if (/\b(kart borc|karti borc|kredi karti odeme|kredi karti ekstresi|ekstre odeme|credit card payment|card payment|kart odemesi)\b/.test(normalized)) return 'card_payment';
  if (/\b(havale|eft|fast transfer|virman|transfer|hesaplar arasi|kendi hesabim|hesabima havale|hesabima transfer)\b/.test(normalized)) return 'transfer';
  if (/\b(iade|refund|iptal|ters kayit|reversal|chargeback)\b/.test(normalized)) return 'refund';
  return 'standard';
}

function sanitizeDescription(value: string): string {
  return value.replace(/\bTR\d{24}\b/gi, '').replace(/\b\d{8,19}\b/g, '').replace(/\b(?:iban|hesap|kart|referans|reference|auth)[ :#-]*[\w-]{6,}\b/gi, '').replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 140);
}

function createItem(sourceRow: number, date: unknown, descriptionValue: unknown, amountValue: unknown, options: { currency?: unknown; direction?: unknown; merchant?: unknown; reference?: unknown; credit?: unknown; debit?: unknown; category?: unknown } = {}): ParsedStatementItem {
  const amount = parseAmount(amountValue, String(options.currency ?? 'TRY'));
  const debit = parseAmount(options.debit, String(options.currency ?? 'TRY'));
  const credit = parseAmount(options.credit, String(options.currency ?? 'TRY'));
  const isNegativeAmount = amount.negative || debit.negative || credit.negative;
  // A negative value always means expense. For a signed amount-only column,
  // positive means income unless explicit direction/debit/credit columns say otherwise.
  let type = isNegativeAmount ? 'Expense' : direction(options.direction) || (amount.minor !== null ? 'Income' : null);
  let minor = amount.minor;
  let originalCurrency = options.currency ?? amount.currency;
  if (debit.minor) { type = 'Expense'; minor = debit.minor; originalCurrency = options.currency ?? debit.currency; }
  if (credit.minor) { type = isNegativeAmount ? 'Expense' : 'Income'; minor = credit.minor; originalCurrency = options.currency ?? credit.currency; }
  const description = sanitizeDescription(String(descriptionValue ?? ''));
  const parsedDate = dateValue(date);
  const entryKind = classifyKind(`${description} ${String(options.direction ?? '')}`);
  const parsedCurrency = currencyCode(originalCurrency, String(amountValue ?? ''));
  return {
    sourceRow,
    transaction_date: parsedDate || '',
    description,
    merchant_name: sanitizeDescription(String(options.merchant ?? descriptionValue ?? '')).slice(0, 120),
    originalAmount: minor ?? 0,
    isNegativeAmount,
    currency_code: parsedCurrency,
    type: entryKind === 'refund' ? 'Expense' : type || 'Expense',
    entry_kind: entryKind,
    confidence: parsedDate && amount.minor !== null && type ? 'high' : parsedDate && minor !== null ? 'medium' : 'low',
    needsReview: !parsedDate || minor === null || !type,
    reference: String(options.reference ?? '').slice(0, 80),
    excluded: entryKind === 'transfer' || entryKind === 'card_payment',
    error: !parsedDate ? `Satır ${sourceRow} · Tarih alanı geçersiz: ${String(date ?? '').slice(0, 30)}. GG.AA.YYYY veya YYYY-AA-GG kullan.` : minor === null ? `Satır ${sourceRow} · Tutar alanı geçersiz: ${String(amountValue ?? '').slice(0, 30)}. Örnek: -1.234,50. Tarih veya bakiye sütununu tutar olarak kullanma.` : !description ? `Satır ${sourceRow} · Açıklama boş.` : !type ? `Satır ${sourceRow} · Gelir/gider yönünü onayla.` : '',
    amountText: String(amountValue ?? ''),
    amount: 0,
    exchange_rate: parsedCurrency === 'TRY' ? 1 : '',
    tcmb_rate: null,
    rate_source: parsedCurrency === 'TRY' ? 'TRY' : 'manual',
    rate_effective_date: parsedCurrency === 'TRY' ? null : null,
    category_id: null,
    category_name: sanitizeDescription(String(options.category ?? '')).slice(0, 80) || null,
    duplicateKind: null,
    duplicateDescription: '',
    confirmPotentialDuplicate: false,
    learnMerchant: false,
  };
}

function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiters = [',', ';', '\t'];
  const delimiter = delimiters.map(char => ({ char, count: (firstLine.match(new RegExp(char === '\t' ? '\\t' : `\\${char}`, 'g')) || []).length })).sort((a, b) => b.count - a.count)[0].char;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sourceLine = 1;
  let quoteStartLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') sourceLine += 1;
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') { if (!quoted) quoteStartLine = sourceLine; quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') { index += 1; sourceLine += 1; }
      row.push(cell); cell = '';
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 100) throw new Error('Ekstre 10000 satır sınırını aşıyor.');
    } else cell += char;
  }
  if (quoted) throw new Error(`Satır ${quoteStartLine} · CSV alanında açılan çift tırnak kapatılmamış. Bu satırın tırnaklarını kontrol et.`);
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex(value => matchesHeader(value, aliases));
}

function matchesHeader(value: unknown, aliases: string[]): boolean {
  const header = fold(value);
  return aliases.some(alias => header === alias || header.startsWith(`${alias} `));
}

function hasTransactionHeader(rows: unknown[][]): boolean {
  return rows.slice(0, 100).some(row => {
    const headers = row.map(String);
    return headerIndex(headers, DATE_HEADER) >= 0
      && headerIndex(headers, DESCRIPTION_HEADER) >= 0
      && (headerIndex(headers, AMOUNT_HEADER) >= 0 || headerIndex(headers, DEBIT_HEADER) >= 0 || headerIndex(headers, CREDIT_HEADER) >= 0);
  });
}

function parseRows(rows: unknown[][]): { parsed: ParsedStatementItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const data = rows.map(row => row.map(cell => cell instanceof Date || typeof cell === 'number' ? cell : String(cell ?? '').trim()));
  let headerRow = -1;
  let indices: { date: number; description: number; amount: number; debit: number; credit: number; currency: number; direction: number; merchant: number; reference: number; category: number } = { date: -1, description: -1, amount: -1, debit: -1, credit: -1, currency: -1, direction: -1, merchant: -1, reference: -1, category: -1 };
  for (let index = 0; index < Math.min(data.length, 100); index += 1) {
    const headers = data[index].map(String);
      const candidate: typeof indices = {
      date: headerIndex(headers, DATE_HEADER), description: headerIndex(headers, DESCRIPTION_HEADER), amount: headerIndex(headers, AMOUNT_HEADER),
      debit: headerIndex(headers, DEBIT_HEADER), credit: headerIndex(headers, CREDIT_HEADER), currency: headerIndex(headers, CURRENCY_HEADER),
      direction: headerIndex(headers, DIRECTION_HEADER), merchant: headerIndex(headers, MERCHANT_HEADER), reference: headerIndex(headers, REFERENCE_HEADER),
      category: headerIndex(headers, CATEGORY_HEADER),
    };
    if (candidate.date >= 0 && candidate.description >= 0 && (candidate.amount >= 0 || candidate.debit >= 0 || candidate.credit >= 0)) { headerRow = index; indices = candidate; break; }
  }
  const parsed: ParsedStatementItem[] = [];
  if (headerRow >= 0) {
    const nonTransactionRows: number[] = [];
    warnings.push(`İşlem başlıkları dosyanın ${headerRow + 1}. satırında bulundu; satır numaraları kaynak dosyaya göredir.`);
    for (let index = headerRow + 1; index < data.length; index += 1) {
      const row = data[index];
      if (!row.some(value => String(value).trim())) continue;
      if (!dateValue(row[indices.date]) && !String(row[indices.description] ?? '').trim() && /^(?:taraflar\b|merkez\b|ticaret sicil\b|www\b|borc\b|alacak\b)/.test(fold(row.join(' ')))) {
        nonTransactionRows.push(index + 1);
        continue;
      }
      if (row.length === 1 && /^(?:tarih araligi|hesap özeti|account statement|bakiye|opening balance|closing balance)/i.test(String(row[0]))) continue;
      parsed.push(createItem(index + 1, row[indices['date']], row[indices['description']], indices['amount'] >= 0 ? row[indices['amount']] : row[indices['debit']] || row[indices['credit']], {
        currency: indices['currency'] >= 0 ? row[indices['currency']] : undefined,
        direction: indices['direction'] >= 0 ? row[indices['direction']] : undefined,
        merchant: indices['merchant'] >= 0 ? row[indices['merchant']] : undefined,
        reference: indices['reference'] >= 0 ? row[indices['reference']] : undefined,
        category: indices['category'] >= 0 ? row[indices['category']] : undefined,
        debit: indices['debit'] >= 0 ? row[indices['debit']] : undefined,
        credit: indices['credit'] >= 0 ? row[indices['credit']] : undefined,
      }));
      if (parsed.length > MAX_ROWS) throw new Error('Ekstre 10000 işlem sınırını aşıyor.');
    }
    if (nonTransactionRows.length) warnings.push(`İşlem olmayan özet/bilgilendirme satırları içe alınmadı: ${nonTransactionRows.join(', ')}.`);
  } else {
    for (let index = 0; index < data.length; index += 1) {
      const row = data[index];
      const dateColumn = row.findIndex(value => dateValue(value));
      if (dateColumn < 0) continue;
      const amountColumns = row.map((value, column) => ({ value, column })).filter(({ value, column }) => column !== dateColumn && !dateValue(value) && parseAmount(value).minor !== null);
      if (amountColumns.length !== 1) continue;
      const amountColumn = amountColumns[0].column;
      if (amountColumn < 0) continue;
      const description = row.map(String).filter((_, column) => column !== dateColumn && column !== amountColumn).join(' ').trim();
      if (!description) continue;
      parsed.push(createItem(index + 1, row[dateColumn], description, row[amountColumn]));
    }
    if (parsed.length) warnings.push('Sütun başlıkları bulunamadı; satırlar otomatik tanındı. Gelir/gider yönünü ve eşleşmeleri onayla.');
  }
  if (!parsed.length) throw new Error(headerRow >= 0 ? `Başlık satırı ${headerRow + 1} tanındı, ancak altında işlem satırı yok.` : 'İlk 100 satırda Tarih, Açıklama ve Tutar / İşlem Tutarı başlıkları birlikte bulunamadı. Dosya bozuk olmayabilir; sütun başlıklarını kontrol et. Başlıksız satırlarda tutar ile bakiye güvenle ayrılamadığı için kayıt oluşturulmadı.');
  if (parsed.length > MAX_ROWS) throw new Error('Ekstre 10000 işlem sınırını aşıyor.');
  return { parsed, warnings };
}

interface PdfLineItem { x: number; text: string; }
interface PdfLine { y: number; items: PdfLineItem[]; }

export function extractPdfTableRows(pages: PdfLine[][]): { rows: unknown[][]; missedRows: number; foundTable: boolean } {
  const rows: unknown[][] = [];
  let missedRows = 0;
  let foundTable = false;

  for (const lines of pages) {
    const header = lines.find(line => {
      const labels = line.items.map(item => fold(item.text));
      return headerIndex(labels, DATE_HEADER) >= 0
        && headerIndex(labels, DESCRIPTION_HEADER) >= 0
        && (headerIndex(labels, AMOUNT_HEADER) >= 0 || headerIndex(labels, DEBIT_HEADER) >= 0 || headerIndex(labels, CREDIT_HEADER) >= 0);
    });
    if (!header) continue;
    foundTable = true;

    const columnHeaders = header.items.flatMap(item => {
      const label = fold(item.text);
      if (matchesHeader(label, DATE_HEADER)) return [{ key: 'date', x: item.x }];
      if (matchesHeader(label, DESCRIPTION_HEADER)) return [{ key: 'description', x: item.x }];
      if (matchesHeader(label, CATEGORY_HEADER)) return [{ key: 'category', x: item.x }];
      if (matchesHeader(label, AMOUNT_HEADER) || matchesHeader(label, DEBIT_HEADER) || matchesHeader(label, CREDIT_HEADER)) return [{ key: 'amount', x: item.x }];
      if (matchesHeader(label, BALANCE_HEADER)) return [{ key: 'balance', x: item.x }];
      return [];
    }).sort((left, right) => left.x - right.x);

    for (const line of lines) {
      if (line.y >= header.y) continue;
      const cells = new Map<string, string[]>();
      for (const item of line.items) {
        let columnIndex = 0;
        for (let index = 0; index < columnHeaders.length - 1; index += 1) {
          const midpoint = (columnHeaders[index].x + columnHeaders[index + 1].x) / 2;
          if (item.x >= midpoint) columnIndex = index + 1;
          else break;
        }
        const column = columnHeaders[columnIndex]?.key;
        if (!column || column === 'balance') continue;
        const values = cells.get(column) || [];
        values.push(item.text);
        cells.set(column, values);
      }

      const date = (cells.get('date') || []).join(' ').trim();
      const description = (cells.get('description') || []).join(' ').replace(/\s+/g, ' ').trim();
      const category = (cells.get('category') || []).join(' ').replace(/\s+/g, ' ').trim();
      const amount = (cells.get('amount') || []).join(' ').replace(/\s+/g, ' ').trim();
      if (!date && !amount) continue;
      if (!dateValue(date) || !parseAmount(amount).minor || !description) {
        missedRows += 1;
        continue;
      }
      rows.push([date, description, category, amount]);
      if (rows.length > MAX_ROWS) throw new Error('Ekstre 10000 işlem sınırını aşıyor.');
    }
  }
  return { rows: [['Tarih', 'Açıklama', 'Kategori', 'Tutar'], ...rows], missedRows, foundTable };
}

@Injectable({ providedIn: 'root' })
export class StatementParserService {
  parseAmountInput(value: string, currency: string): number | null {
    const parsed = parseAmount(value, currency);
    return parsed.minor;
  }

  async parse(file: File): Promise<ParsedStatement> {
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Dosya boş veya 10 MB sınırını aşıyor.');
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const format = ({ csv: 'CSV', xls: 'XLS', xlsx: 'XLSX', pdf: 'PDF' } as Record<string, ParsedStatement['format']>)[extension];
    if (!format) throw new Error('Yalnızca CSV, XLS, XLSX veya metin tabanlı PDF seçebilirsin.');
    const bytes = await file.arrayBuffer();
    const header = [...new Uint8Array(bytes.slice(0, 8))].map(value => value.toString(16).padStart(2, '0')).join('').toLowerCase();
    if (format === 'PDF' && !header.startsWith('255044462d')) throw new Error('PDF dosya imzası doğrulanamadı.');
    if (format === 'XLSX' && !header.startsWith('504b')) throw new Error('XLSX dosya imzası doğrulanamadı.');
    if (format === 'XLS' && !header.startsWith('d0cf11e0a1b11ae1')) throw new Error('XLS dosya imzası doğrulanamadı.');
    if (format === 'CSV' && new Uint8Array(bytes).includes(0)) throw new Error('CSV dosyasında beklenmeyen ikili veri var.');
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const fileSha256 = [...new Uint8Array(hashBuffer)].map(value => value.toString(16).padStart(2, '0')).join('');
    let rows: unknown[][];
    let warnings: string[] = [];
    if (format === 'CSV') {
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { content = new TextDecoder('windows-1254').decode(bytes); warnings.push('Dosya Windows Türkçe karakter kodlamasıyla okundu.'); }
      rows = parseDelimited(content.replace(/^\uFEFF/, ''));
    } else if (format === 'XLS' || format === 'XLSX') {
      let workbook: XLSXTypes.WorkBook;
      const XLSX = await import('xlsx');
      try { workbook = XLSX.read(bytes, { type: 'array', cellDates: false, WTF: false, sheetRows: MAX_ROWS + 10 }); }
      catch (error) { const reason = error instanceof Error ? error.message.slice(0, 160) : 'Bilinmeyen okuma hatası'; throw new Error(`Excel çalışma kitabı açılamadı: ${reason}. İşlem satırlarına erişilemediği için satır numarası belirlenemedi.`); }
      if (!workbook.SheetNames.length) throw new Error('Excel dosyasında sayfa bulunamadı.');
      const sheets = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, blankrows: true, defval: '' }) as unknown[][],
      }));
      const transactionSheet = sheets.find(sheet => hasTransactionHeader(sheet.rows));
      if (!transactionSheet) throw new Error('Excel sayfalarında Tarih, Açıklama ve Tutar başlıklarıyla eşleşen bir işlem tablosu bulunamadı. Başlıkları içe aktarma tablosuna göre düzenleyip tekrar dene.');
      rows = transactionSheet.rows;
      if (transactionSheet.name !== workbook.SheetNames[0]) warnings.push(`İşlem tablosu “${transactionSheet.name}” sayfasında bulundu; diğer sayfalar içe aktarılmadı.`);
    } else {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).toString();
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      let pdfDocument: PDFDocumentProxy;
      try { pdfDocument = await loadingTask.promise; }
      catch { throw new Error('PDF okunamadı. Dosya bozuk, şifreli veya görüntü tabanlı olabilir; CSV ya da Excel biçiminde dışa aktar.'); }
      if (pdfDocument.numPages > PDF_MAX_PAGES) { await loadingTask.destroy(); throw new Error('PDF 100 sayfa sınırını aşıyor.'); }
      const pages: PdfLine[][] = [];
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const text = await page.getTextContent();
        if (!text.items.length) { pages.push([]); page.cleanup(); continue; }
        const items = text.items.filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && 'transform' in item);
        const groups = new Map<number, Array<{ x: number; text: string }>>();
        for (const item of items) {
          const y = Math.round(item.transform[5] / 2) * 2;
          const group = groups.get(y) || [];
          group.push({ x: item.transform[4], text: item.str });
          groups.set(y, group);
        }
        const pageLines = [...groups.entries()].map(([y, lineItems]) => ({ y, items: lineItems.sort((a, b) => a.x - b.x) })).sort((a, b) => b.y - a.y);
        pages.push(pageLines);
        page.cleanup();
      }
      await loadingTask.destroy();
      const extracted = extractPdfTableRows(pages);
      if (!extracted.foundTable) throw new Error('PDF’de tanınan Tarih, Açıklama ve Tutar başlıklı bir işlem tablosu bulunamadı. Excel veya CSV olarak yükleyebilir ya da Excel şablonuna dönüştürebilirsin.');
      rows = extracted.rows;
      warnings.push('PDF’den yalnızca işlem tablosundaki tarih, açıklama, etiket ve tutar sütunları alındı; bakiye ve sayfa bilgileri dışarıda bırakıldı. Satırları kaydetmeden önce gözden geçir.');
      if (extracted.missedRows) warnings.push(`${extracted.missedRows} tablo satırı güvenle eşleştirilemedi ve önizlemeye eklenmedi.`);
    }
    const result = parseRows(rows);
    warnings.push(...result.warnings);
    const skipped = result.parsed.filter(item => item.excluded).length;
    return { fileName: file.name, fileSha256, rows: result.parsed, warnings, skipped, format };
  }
}
