const path = require('node:path');
const express = require('express');
const { chromium } = require('@playwright/test');

const app = express();
const browserDir = path.join(__dirname, '..', 'dist', 'my-finance', 'browser');
const screenshotDir = path.join(__dirname, '..', 'docs', 'screenshots');
const today = new Date();
const year = today.getFullYear();
const month = String(today.getMonth() + 1).padStart(2, '0');
const date = `${year}-${month}-${String(today.getDate()).padStart(2, '0')}`;
const categories = [
  { id: 1, name: 'Market', type: 'Expense', color: '#35644c', icon: 'basket', is_default: 1, is_preferred: 1 },
  { id: 2, name: 'Ulaşım', type: 'Expense', color: '#bd8a40', icon: 'car', is_default: 1, is_preferred: 0 },
  { id: 3, name: 'Restoran', type: 'Expense', color: '#c87855', icon: 'restaurant', is_default: 1, is_preferred: 0 },
  { id: 4, name: 'Konut', type: 'Expense', color: '#747f78', icon: 'home', is_default: 1, is_preferred: 0 },
  { id: 5, name: 'Maaş', type: 'Income', color: '#4f8b69', icon: 'briefcase', is_default: 1, is_preferred: 1 },
  { id: 6, name: 'Freelance', type: 'Income', color: '#497d82', icon: 'laptop', is_default: 1, is_preferred: 0 },
];
const monthly = Array.from({ length: 12 }, (_, index) => ({
  month: String(index + 1).padStart(2, '0'),
  income: index < today.getMonth() ? 7_800_000 + index * 70_000 : index === today.getMonth() ? 8_500_000 : 0,
  expense: index < today.getMonth() ? 4_200_000 - index * 36_000 : index === today.getMonth() ? 3_788_000 : 0,
}));
let nextTransactionId = 1;
const transactions = [];
for (let index = 0; index <= today.getMonth(); index++) {
  const period = monthly[index];
  const periodMonth = period.month;
  const periodDate = day => `${year}-${periodMonth}-${String(index === today.getMonth() ? Math.min(day, today.getDate()) : day).padStart(2, '0')}`;
  const add = (type, amount, description, categoryId, transactionDate) => {
    const category = categories.find(item => item.id === categoryId);
    transactions.push({ id: nextTransactionId++, type, amount, original_amount: amount, currency_code: 'TRY', exchange_rate: 1, tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description, category_id: categoryId, category: category.name, category_color: category.color, transaction_date: transactionDate });
  };
  add('Income', period.income, index === today.getMonth() ? 'Aylık maaş' : `${periodMonth}.${year} maaşı`, 5, periodDate(1));
  const housing = Math.round(period.expense * .58);
  const market = Math.round(period.expense * .25);
  const restaurant = Math.round(period.expense * .10);
  const transport = period.expense - housing - market - restaurant;
  add('Expense', housing, 'Konut gideri', 4, periodDate(2));
  add('Expense', market, 'Haftalık market alışverişi', 1, periodDate(5));
  add('Expense', restaurant, 'Akşam yemeği', 3, periodDate(10));
  add('Expense', transport, 'Ulaşım kartı', 2, periodDate(15));
}
transactions.sort((left, right) => right.transaction_date.localeCompare(left.transaction_date) || right.id - left.id);
const totalIncome = monthly.reduce((sum, item) => sum + item.income, 0);
const totalExpense = monthly.reduce((sum, item) => sum + item.expense, 0);
const currentMonth = monthly[today.getMonth()];
const previousMonth = monthly[Math.max(0, today.getMonth() - 1)];
let settings = { currency: 'TRY', theme: 'light', language: 'tr' };

app.use(express.static(browserDir));
app.get('*', (_req, res) => res.sendFile(path.join(browserDir, 'index.html')));

const server = app.listen(0, '127.0.0.1', async () => {
  let browser;
  try {
    browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let body = [];
      if (url.pathname === '/api/auth/config') body = { googleClientId: null };
      else if (url.pathname === '/api/auth/me') body = { user: { id: 1, email: 'deniz.ornek@example.invalid', name: 'Deniz Örnek' } };
      else if (url.pathname === '/api/exchange-rates/currencies') body = { effectiveDate: date, currencies: ['EUR', 'USD', 'GBP'] };
      else if (url.pathname === '/api/exchange-rates') {
        const currency = url.searchParams.get('currency') || 'USD';
        const rate = { EUR: 49.12, USD: 42.08, GBP: 56.31 }[currency] || 1;
        const effective = new Date(`${url.searchParams.get('date') || date}T00:00:00Z`);
        effective.setUTCDate(effective.getUTCDate() - 1);
        while (effective.getUTCDay() === 0 || effective.getUTCDay() === 6) effective.setUTCDate(effective.getUTCDate() - 1);
        body = { currency, rate, unit: 1, effectiveDate: effective.toISOString().slice(0, 10), source: 'TCMB', basis: 'Efektif alış' };
      }
      else if (url.pathname === '/api/categories') body = categories;
      else if (url.pathname === '/api/transactions') body = transactions;
      else if (url.pathname === '/api/dashboard/summary') body = { balance: totalIncome - totalExpense, income: totalIncome, expense: totalExpense, monthIncome: currentMonth.income, monthExpense: currentMonth.expense, previousMonthIncome: previousMonth.income, previousMonthExpense: previousMonth.expense, recent: transactions.slice(0, 6), categories: [{ name: 'Konut', color: '#747f78', amount: Math.round(currentMonth.expense * .58) }, { name: 'Market', color: '#35644c', amount: Math.round(currentMonth.expense * .25) }, { name: 'Restoran', color: '#c87855', amount: Math.round(currentMonth.expense * .10) }, { name: 'Ulaşım', color: '#bd8a40', amount: currentMonth.expense - Math.round(currentMonth.expense * .93) }] };
      else if (url.pathname === '/api/reports/monthly') body = monthly;
      else if (url.pathname === '/api/reports/yearly') body = [{ year: String(year), income: totalIncome, expense: totalExpense }];
      else if (url.pathname === '/api/settings' && route.request().method() === 'PUT') { settings = { ...settings, ...route.request().postDataJSON() }; body = settings; }
      else if (url.pathname === '/api/settings') body = settings;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.locator('.app-shell').waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: 'Hoş geldin, Deniz Örnek' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const faviconPixels = await page.evaluate(async () => {
      const image = new Image();
      image.src = '/denge-mark.svg';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return 0;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible++;
      return visible;
    });
    if (faviconPixels < 100) throw new Error('The infinity favicon contains no visible logo pixels.');
    if (!(await page.locator('.brand-mark').first().evaluate(element => getComputedStyle(element).backgroundImage)).includes('denge-infinity.png')) throw new Error('Denge logo asset could not be loaded.');
    if (!(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).includes('Segoe UI Variable')) throw new Error('The updated sans-serif font was not applied.');
    for (const selector of ['body', '.sidebar', '.topbar', '.balance-card', '.transactions-panel']) {
      if (await page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor) !== 'rgb(255, 255, 255)') throw new Error(`The light ${selector} surface is not white.`);
    }
    await page.screenshot({ path: path.join(screenshotDir, 'dashboard-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Koyu tema' }).click();
    await page.waitForTimeout(900);
    if (await page.locator('html').getAttribute('data-theme') !== 'dark') throw new Error('Dark theme did not activate.');
    for (const selector of ['body', '.sidebar', '.topbar', '.balance-card', '.transactions-panel']) {
      const expected = selector === 'body' ? 'rgb(0, 0, 0)' : 'rgb(16, 16, 16)';
      if (await page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor) !== expected) throw new Error(`The dark ${selector} surface is not neutral black.`);
    }
    await page.screenshot({ path: path.join(screenshotDir, 'dashboard-dark.png'), fullPage: true });
    await page.getByRole('button', { name: 'Açık tema' }).click();
    await page.locator('.sidebar nav button').filter({ hasText: 'Raporlar' }).click();
    await page.getByRole('heading', { name: 'Finansal raporların' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotDir, 'reports-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
    await page.getByRole('heading', { name: 'İşlemlerin' }).waitFor({ state: 'visible' });
    await page.locator('tbody tr:first-child td:nth-child(3)').waitFor({ state: 'visible' });
    await page.locator('tbody tr:first-child td:nth-child(4)').waitFor({ state: 'visible' });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Mobile layout overflows horizontally.');
    await page.screenshot({ path: path.join(screenshotDir, 'transactions-mobile.png') });
    if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join('; ')}`);
    console.log('Updated light/dark dashboard, reports, and mobile screenshots using isolated mock data.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
