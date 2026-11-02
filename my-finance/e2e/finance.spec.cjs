const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const sessionToken = 'denge-playwright-session-token';
const screenshotDir = path.join(process.cwd(), 'docs', 'screenshots');
const year = new Date().getFullYear();
const browserErrors = new WeakMap();

test.beforeEach(async ({ page, context }) => {
  browserErrors.set(page, []);
  page.on('pageerror', error => browserErrors.get(page).push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.get(page).push(message.text());
  });
  await context.addCookies([{
    name: 'denge_session',
    value: sessionToken,
    url: 'http://127.0.0.1:4202',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'browser console and runtime errors').toEqual([]);
});

test('dashboard greets the signed-in user and prefills a transaction category', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Hoş geldin, Deniz Örnek' })).toBeVisible();
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'dashboard-desktop.png'), fullPage: true });

  await page.locator('.top-actions .quick-add').click();
  await expect(page.locator('select[name="category"] option:checked')).toHaveText('Market');
  await page.getByRole('button', { name: 'Gelir', exact: true }).click();
  await expect(page.locator('select[name="category"] option:checked')).toHaveText('Maaş');
});

test('transaction list filters by an inclusive date range', async ({ page }) => {
  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  await page.getByLabel('Başlangıç tarihi').fill(`${year}-01-10`);
  await page.getByLabel('Bitiş tarihi').fill(`${year}-01-10`);

  await expect(page.getByText('1 kayıt listeleniyor')).toBeVisible();
  await expect(page.getByText('Ocak market alışverişi')).toBeVisible();
  await expect(page.getByText('Şubat ulaşım kartı')).toHaveCount(0);
});

test('report range recalculates categories and exports a report CSV', async ({ page }) => {
  await page.locator('.sidebar nav button').filter({ hasText: 'Raporlar' }).click();
  await page.locator('#report-from').fill(`${year}-02-15`);
  await page.locator('#report-to').fill(`${year}-02-15`);

  await expect(page.locator('.category-report').getByRole('heading', { name: 'Ulaşım' })).toBeVisible();
  await expect(page.locator('.category-report').getByRole('heading', { name: 'Market' })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Raporu CSV indir/ }).click();
  expect((await download).suggestedFilename()).toContain(`denge-rapor_${year}-02-15_${year}-02-15.csv`);
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'reports-desktop.png'), fullPage: true });
});

test('custom category icon can be selected and saved', async ({ page }) => {
  await page.locator('.sidebar nav button').filter({ hasText: 'Kategoriler' }).click();
  await page.locator('.welcome-row .quick-add').click();
  await page.getByLabel('Kategori adı').fill('Evcil hayvan');
  await page.getByLabel('Tür').selectOption('Expense');
  await page.getByLabel('Simge').selectOption('paw');
  await page.getByRole('button', { name: 'Kaydet' }).click();

  const category = page.locator('.category-item').filter({ hasText: 'Evcil hayvan' });
  await expect(category).toBeVisible();
  await expect(category.locator('.category-icon-badge')).toHaveText('🐾');
  await category.getByRole('button', { name: 'Varsayılan yap' }).click();
  await expect(category.getByRole('button', { name: 'İşlem varsayılanı' })).toHaveAttribute('aria-pressed', 'true');
});

test('mobile layout stays within the viewport and exposes transaction filters', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  await expect(page.getByLabel('Başlangıç tarihi')).toBeVisible();
  await expect(page.getByLabel('Bitiş tarihi')).toBeVisible();
  const hasHorizontalPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalPageOverflow).toBe(false);
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'transactions-mobile.png'), fullPage: true });
});
