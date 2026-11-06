const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTcmbRates, calculateTryMinor, fetchTcmbXml, getTcmbRate, matchesTcmbQuote } = require('../mysql-server.cjs');

test('parses TCMB effective buying rates and respects the published unit', () => {
  const xml = '<Tarih_Date Tarih="02.11.2026"><Currency CurrencyCode="USD"><Unit>1</Unit><BanknoteBuying>42.2500</BanknoteBuying></Currency><Currency CurrencyCode="JPY"><Unit>100</Unit><BanknoteBuying>28.5000</BanknoteBuying></Currency><Currency CurrencyCode="EUR"><Unit>1</Unit><BanknoteBuying>-</BanknoteBuying></Currency></Tarih_Date>';
  const parsed = parseTcmbRates(xml);
  assert.equal(parsed.effectiveDate, '2026-11-02');
  assert.equal(parsed.rates.get('USD').rate, 42.25);
  assert.equal(parsed.rates.get('JPY').rate, 0.285);
  assert.equal(parsed.rates.has('EUR'), false);
});

test('converts currency minor units using integer arithmetic and half-up rounding', () => {
  assert.equal(calculateTryMinor(12_345, '32.5000000000'), 401_213);
  assert.equal(calculateTryMinor(10_000, '0.285'), 2_850);
  assert.equal(calculateTryMinor(100, '0.285', 'JPY'), 2_850);
  assert.equal(calculateTryMinor(12_345, '32.5', 'KWD'), 40_121);
  assert.equal(calculateTryMinor(1, '0.5'), 1);
  assert.equal(calculateTryMinor(1, '0.49'), 0);
  assert.equal(calculateTryMinor(100, '1e2'), null);
});

test('requires the applied TCMB rate, recorded reference, and effective date to match the official quote', () => {
  const body = { exchange_rate: '42.25', tcmb_rate: '42.2500000000', rate_effective_date: '2026-11-02' };
  const official = { rate: 42.25, effectiveDate: '2026-11-02' };
  assert.equal(matchesTcmbQuote(body, official), true);
  assert.equal(matchesTcmbQuote({ ...body, tcmb_rate: null }, official), false);
  assert.equal(matchesTcmbQuote({ ...body, tcmb_rate: '41.90' }, official), false);
  assert.equal(matchesTcmbQuote({ ...body, exchange_rate: '41.90' }, official), false);
  assert.equal(matchesTcmbQuote({ ...body, rate_effective_date: '2026-11-01' }, official), false);
});

test('refreshes today’s TCMB file within five minutes while caching archived files for a day', async () => {
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const todayUrl = 'https://www.tcmb.gov.tr/kurlar/today.xml';
  const archivedUrl = 'https://www.tcmb.gov.tr/kurlar/202611/02112026.xml';
  const requests = new Map();
  const fetchFixture = async url => {
    const count = (requests.get(url) || 0) + 1;
    requests.set(url, count);
    return { ok: true, text: async () => `<Tarih_Date Tarih="02.11.2026"><Currency CurrencyCode="USD"><Unit>1</Unit><BanknoteBuying>${42 + count}</BanknoteBuying></Currency></Tarih_Date>` };
  };

  try {
    assert.match(await fetchTcmbXml(todayUrl, fetchFixture), /43/);
    assert.match(await fetchTcmbXml(todayUrl, fetchFixture), /43/);
    assert.match(await fetchTcmbXml(archivedUrl, fetchFixture), /43/);
    now += 5 * 60 * 1000 + 1;
    assert.match(await fetchTcmbXml(todayUrl, fetchFixture), /44/);
    assert.match(await fetchTcmbXml(archivedUrl, fetchFixture), /43/);
    now += 24 * 60 * 60 * 1000;
    assert.match(await fetchTcmbXml(archivedUrl, fetchFixture), /44/);
    assert.equal(requests.get(todayUrl), 2);
    assert.equal(requests.get(archivedUrl), 2);
  } finally {
    Date.now = realNow;
  }
});

test('shares one in-flight TCMB file request between concurrent currency lookups', async () => {
  const url = 'https://www.tcmb.gov.tr/kurlar/202611/03112026.xml';
  let calls = 0;
  const fetchFixture = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ok: true, text: async () => '<Tarih_Date Tarih="03.11.2026"><Currency CurrencyCode="USD"><Unit>1</Unit><BanknoteBuying>42.5000</BanknoteBuying></Currency></Tarih_Date>' };
  };
  const [first, second] = await Promise.all([fetchTcmbXml(url, fetchFixture), fetchTcmbXml(url, fetchFixture)]);
  assert.equal(calls, 1);
  assert.equal(first, second);
});

test('uses the prior business-day rate and walks back over unpublished weekend files', async () => {
  const requestedUrls = [];
  const fetchFixture = async url => {
    requestedUrls.push(url);
    if (url.endsWith('/30102026.xml')) return '<Tarih_Date Tarih="30.10.2026"><Currency CurrencyCode="USD"><Unit>1</Unit><BanknoteBuying>42.1250</BanknoteBuying></Currency></Tarih_Date>';
    const missing = new Error('Archived XML does not exist on non-working day.');
    missing.status = 404;
    throw missing;
  };

  const quote = await getTcmbRate('USD', '2026-11-01', fetchFixture);
  assert.deepEqual(requestedUrls, [
    'https://www.tcmb.gov.tr/kurlar/202610/30102026.xml',
  ]);
  assert.deepEqual(quote, { currency: 'USD', rate: 42.125, unit: 1, effectiveDate: '2026-10-30', source: 'TCMB', basis: 'Efektif alış' });
});

test('uses the rate announced on the prior business day for a transaction date', async () => {
  const requestedUrls = [];
  const fetchFixture = async url => {
    requestedUrls.push(url);
    assert.equal(url, 'https://www.tcmb.gov.tr/kurlar/202611/02112026.xml');
    return '<Tarih_Date Tarih="02.11.2026"><Currency CurrencyCode="EUR"><Unit>1</Unit><BanknoteBuying>49.1250</BanknoteBuying></Currency></Tarih_Date>';
  };

  const quote = await getTcmbRate('EUR', '2026-11-03', fetchFixture);
  assert.equal(requestedUrls.length, 1);
  assert.deepEqual(quote, { currency: 'EUR', rate: 49.125, unit: 1, effectiveDate: '2026-11-02', source: 'TCMB', basis: 'Efektif alış' });
});
