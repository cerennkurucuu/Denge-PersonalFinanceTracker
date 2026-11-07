const { test, expect } = require('@playwright/test');

const sessionToken = 'denge-playwright-session-token';
const year = new Date().getFullYear();
const browserErrors = new WeakMap();
const networkErrors = new WeakMap();

function previousBusinessDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

test.beforeEach(async ({ page, context }) => {
  browserErrors.set(page, []);
  networkErrors.set(page, []);
  page.on('pageerror', error => browserErrors.get(page).push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.get(page).push(message.text());
  });
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText || 'request failed';
    if (reason !== 'net::ERR_ABORTED') networkErrors.get(page).push(`${request.method()} ${request.url()}: ${reason}`);
  });
  page.on('response', response => {
    if (response.status() >= 500) networkErrors.get(page).push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  await page.route('**/api/exchange-rates/currencies', route => route.fulfill({ json: { effectiveDate: '2026-11-02', currencies: ['EUR', 'USD', 'GBP'] } }));
  await page.route('**/api/exchange-rates?*', route => {
    const query = new URL(route.request().url()).searchParams;
    const currency = query.get('currency') || 'USD';
    const rates = { EUR: 49.25, USD: 42.25, GBP: 56.5 };
    return route.fulfill({ json: { currency, rate: rates[currency] || 42.25, unit: 1, effectiveDate: previousBusinessDate(query.get('date') || `${year}-11-02`), source: 'TCMB', basis: 'Efektif alış' } });
  });
  await page.route('**/api/exchange-rates/batch', route => {
    const { items = [] } = route.request().postDataJSON();
    const rates = { EUR: 49.25, USD: 42.25, GBP: 56.5 };
    const quotes = Object.fromEntries(items.map(({ currency, date }) => [`${currency}|${date}`, {
      quote: { currency, rate: rates[currency] || 42.25, unit: 1, effectiveDate: previousBusinessDate(date), source: 'TCMB', basis: 'Efektif alış' },
    }]));
    return route.fulfill({ json: { quotes } });
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
  await expect(page.locator('.loading-card')).toHaveCount(0);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'browser console and runtime errors').toEqual([]);
  expect(networkErrors.get(page), 'failed requests and server errors').toEqual([]);
});

test('dashboard greets the signed-in user and prefills a transaction category', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Hoş geldin, Deniz Örnek' })).toBeVisible();
  const brandMark = page.locator('.sidebar .brand-mark');
  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveAttribute('aria-label', 'Denge logosu');
  expect(await brandMark.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('denge-infinity.png');
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toContain('Segoe UI Variable');
  await expect(page.locator('.balance-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (const selector of ['.sidebar', '.topbar', '.transactions-panel']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  await expect(page.locator('.sidebar nav button.active')).toHaveCSS('background-color', 'rgb(241, 241, 241)');
  await expect(page.getByRole('heading', { name: 'Döviz kurları' })).toBeVisible();
  await expect(page.locator('.rate-item')).toHaveCount(3);
  await expect(page.locator('.rate-item').filter({ hasText: 'EUR' })).toContainText('49,25 ₺');

  const themeSaved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/settings');
  await page.getByRole('button', { name: 'Koyu tema' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.balance-card')).toHaveCSS('background-color', 'rgb(16, 16, 16)');
  for (const selector of ['.sidebar', '.topbar', '.transactions-panel']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(16, 16, 16)');
  }
  await expect(page.locator('.sidebar nav button.active')).toHaveCSS('background-color', 'rgb(27, 27, 27)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await themeSaved;
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.loading-card')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('.top-actions .quick-add').click();
  for (const currency of ['EUR', 'USD', 'GBP']) {
    await expect(page.locator('#transaction-currency option').filter({ hasText: currency })).toHaveCount(1);
  }
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

test('income uses its preferred category and remains available after a reload', async ({ page }) => {
  await page.locator('.top-actions .quick-add').click();
  await page.getByRole('button', { name: 'Gelir', exact: true }).click();
  await expect(page.locator('select[name="category"] option:checked')).toHaveText('Maaş');
  await page.getByLabel('Tutar').fill('8000.00');
  await page.getByRole('textbox', { name: 'Açıklama', exact: true }).fill('E2E gelir kaydı');
  await page.getByRole('button', { name: 'İşlemi kaydet' }).click();
  await expect(page.getByText('İşlem eklendi.')).toBeVisible();

  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  const incomeRow = page.locator('tbody tr').filter({ hasText: 'E2E gelir kaydı' });
  await expect(incomeRow).toContainText('Maaş');
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.loading-card')).toHaveCount(0);
  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'E2E gelir kaydı' })).toBeVisible();
});

test('a TRY expense can be added, edited, and deleted through the interface', async ({ page }) => {
  await page.locator('.top-actions .quick-add').click();
  await expect(page.locator('select[name="category"] option:checked')).toHaveText('Market');
  await page.getByLabel('Tutar').fill('12.50');
  await page.getByRole('textbox', { name: 'Açıklama', exact: true }).fill('E2E düzenlenecek gider');
  await page.getByRole('button', { name: 'İşlemi kaydet' }).click();
  await expect(page.getByText('İşlem eklendi.')).toBeVisible();

  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  let expenseRow = page.locator('tbody tr').filter({ hasText: 'E2E düzenlenecek gider' });
  await expect(expenseRow).toContainText('Market');
  await expenseRow.getByRole('button', { name: 'Düzenle' }).click();
  await page.getByLabel('Tutar').fill('15.75');
  await page.getByLabel('Açıklama', { exact: true }).fill('E2E düzenlenmiş gider');
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await expect(page.getByText('İşlem güncellendi.')).toBeVisible();

  expenseRow = page.locator('tbody tr').filter({ hasText: 'E2E düzenlenmiş gider' });
  await expect(expenseRow).toContainText('15,75');
  await expenseRow.getByRole('button', { name: 'Sil' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(page.getByText('İşlem silindi.')).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'E2E düzenlenmiş gider' })).toHaveCount(0);
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
});

test('custom category icon and color can be selected and saved', async ({ page }) => {
  await page.locator('.sidebar nav button').filter({ hasText: 'Kategoriler' }).click();
  await page.locator('.welcome-row .quick-add').click();
  await page.getByLabel('Kategori adı').fill('Evcil hayvan');
  await page.getByLabel('Tür').selectOption('Expense');
  await page.getByLabel('Simge').selectOption('paw');
  await page.getByRole('button', { name: '#2d6a4f rengini seç' }).click();
  await page.getByRole('button', { name: 'Kaydet' }).click();

  const category = page.locator('.category-item').filter({ hasText: 'Evcil hayvan' });
  await expect(category).toBeVisible();
  await expect(category.locator('.category-icon-badge')).toHaveText('🐾');
  await expect(category.locator('.category-icon-badge')).toHaveCSS('color', 'rgb(45, 106, 79)');
  await category.getByRole('button', { name: 'Varsayılan yap' }).click();
  await expect(category.getByRole('button', { name: 'İşlem varsayılanı' })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.top-actions .quick-add').click();
  await expect(page.locator('select[name="category"] option:checked')).toHaveText('Evcil hayvan');
  await page.getByRole('button', { name: 'Kapat' }).click();
  await category.getByRole('button', { name: 'Düzenle' }).click();
  await page.getByLabel('Kategori adı').fill('Evcil hayvan güncellendi');
  await page.getByRole('button', { name: 'Kaydet' }).click();

  const editedCategory = page.locator('.category-item').filter({ hasText: 'Evcil hayvan güncellendi' });
  await expect(editedCategory).toBeVisible();
  await editedCategory.getByRole('button', { name: 'Sil' }).click();
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(page.getByText('Kategori silindi.')).toBeVisible();
  await expect(page.locator('.category-item').filter({ hasText: 'Evcil hayvan güncellendi' })).toHaveCount(0);
});

test('foreign-currency transactions use the official rate and allow a recorded manual correction', async ({ page }) => {
  await page.route('**/api/exchange-rates/currencies', route => route.fulfill({ json: { effectiveDate: '2026-11-02', currencies: ['EUR', 'USD'] } }));
  await page.route('**/api/exchange-rates?*', route => route.fulfill({ json: { currency: 'USD', rate: 42.25, unit: 1, effectiveDate: '2026-11-02', source: 'TCMB', basis: 'Efektif alış' } }));
  await page.locator('.top-actions .quick-add').click();
  await page.getByLabel('Para birimi').selectOption('USD');
  await expect(page.locator('.source-badge')).toContainText('TCMB · Efektif alış');
  await expect(page.locator('#exchange-rate')).not.toHaveValue('');
  await page.getByLabel('Tutar').fill('12.34');
  await page.getByRole('button', { name: 'Kuru elle düzenle' }).click();
  await expect(page.locator('.manual-badge')).toHaveText('Elle düzenlendi');
  await page.locator('#exchange-rate').fill('40.5');
  await expect(page.locator('.manual-badge')).toHaveText('Elle düzenlendi');
  await expect(page.locator('.conversion-preview')).toContainText('₺');
  await page.getByRole('textbox', { name: 'Açıklama', exact: true }).fill('E2E döviz kaydı');
  await page.getByRole('button', { name: 'İşlemi kaydet' }).click();
  await expect(page.getByText('İşlem eklendi.')).toBeVisible();

  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  const row = page.locator('tbody tr').filter({ hasText: 'E2E döviz kaydı' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('elle kur');
  await expect(row).toContainText('40,5');
});

test('statement import reads a selected file, classifies signed amounts, saves, and refreshes the list', async ({ page }) => {
  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  await page.getByRole('button', { name: 'Ekstre aktar' }).click();

  await page.getByLabel('Banka ekstresi dosyası seç').setInputFiles({
    name: 'ornek-hareket.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Tarih;Açıklama;Tutar;Para Birimi\n05.11.2026;HARCIRAH ÖDEMESİ;4.200,00;TRY\n', 'utf8'),
  });

  await expect(page.locator('.file-summary')).toContainText('1 içe alınmaya hazır');
  await expect(page.locator('.preview-table tbody tr').first().locator('select[aria-label="Gelir veya gider"]')).toHaveValue('Income');
  await expect(page.locator('.preview-table tbody tr').first()).toContainText('Hazır');
  await page.getByRole('button', { name: 'Seçili işlemleri ekle' }).click();

  await expect(page.getByText(/Ekstre işlendi: 1 eklendi/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Banka ekstresi' })).toHaveCount(0);
  await expect(page.locator('tbody tr').filter({ hasText: 'HARCIRAH ÖDEMESİ' })).toContainText('Gelir');
});

test('multiple transactions can be selected and deleted together', async ({ page }) => {
  for (const description of ['E2E toplu sil 1', 'E2E toplu sil 2']) {
    await page.locator('.top-actions .quick-add').click();
    await page.getByLabel('Tutar').fill('3.25');
    await page.getByRole('textbox', { name: 'Açıklama', exact: true }).fill(description);
    await page.getByRole('button', { name: 'İşlemi kaydet' }).click();
    await expect(page.getByText('İşlem eklendi.')).toBeVisible();
  }

  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  for (const description of ['E2E toplu sil 1', 'E2E toplu sil 2']) {
    await page.locator('tbody tr').filter({ hasText: description }).getByRole('checkbox').check();
  }
  await expect(page.getByText('2 işlem seçildi')).toBeVisible();
  await page.getByRole('button', { name: 'Seçilenleri sil' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('2 işlem silinsin mi?');
  await confirmation.getByRole('button', { name: 'Seçilenleri sil' }).click();
  await expect(page.getByText('2 işlem silindi.')).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'E2E toplu sil' })).toHaveCount(0);
});

test('mobile layout stays within the viewport and exposes transaction filters', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.sidebar nav button').filter({ hasText: 'İşlemler' }).click();
  await expect(page.getByLabel('Başlangıç tarihi')).toBeVisible();
  await expect(page.getByLabel('Bitiş tarihi')).toBeVisible();
  await expect(page.locator('tbody tr').first().locator('td').nth(2)).toBeVisible();
  await expect(page.locator('tbody tr').first().locator('td').nth(3)).toBeVisible();
  const hasHorizontalPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalPageOverflow).toBe(false);
});

test('financial calendar creates a repeating plan, links an actual payment once, and preserves it after plan removal', async ({page}) => {
  await page.locator('.sidebar nav button').filter({hasText:'Takvim'}).click();
  await expect(page.getByRole('heading',{name:'Finansal takvim',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Yeni planlanan ödeme/}).click();
  await page.getByLabel('Plan başlığı',{exact:true}).fill('E2E takvim faturası');
  await page.getByLabel('Ödeme / gelir türü').selectOption('bill');
  await page.locator('#calendar-amount').fill('12.50');
  await page.getByRole('combobox',{name:'Tekrarlama',exact:true}).selectOption('monthly');
  await page.getByLabel('Kaç ay tekrarlansın?').fill('3');
  await expect(page.getByText(/Son ödeme:/)).toBeVisible();
  await page.getByRole('button',{name:'Planı kaydet',exact:true}).click();
  await expect(page.getByText('Takvim planı kaydedildi. Gerçek gelir/gider kaydı oluşturulmadı.')).toBeVisible();
  await expect(page.locator('.day-detail .event-row').filter({hasText:'E2E takvim faturası'})).toContainText('Planlanan');
  await expect(page.locator('.outlook-total > strong')).toContainText('12,50');

  await page.locator('.top-actions .quick-add').click();
  await page.locator('#transaction-amount').fill('12.50');
  await page.getByRole('textbox',{name:'Açıklama',exact:true}).fill('E2E takvim gerçek ödeme');
  await page.getByRole('button',{name:'İşlemi kaydet'}).click();
  await expect(page.getByText('İşlem eklendi.')).toBeVisible();
  await page.getByRole('button',{name:'Takvimi yenile',exact:true}).click();
  const occurrence=page.locator('.day-detail .event-row').filter({hasText:'E2E takvim faturası'});
  await expect(occurrence).toContainText('eşleşebilecek işlem');
  await occurrence.getByRole('button',{name:'Gerçekleşen işlemi bağla'}).click();
  const option=page.locator('#calendar-link-transaction option').filter({hasText:'E2E takvim gerçek ödeme'});
  await page.locator('#calendar-link-transaction').selectOption(await option.getAttribute('value'));
  await page.locator('.link-panel').getByRole('button',{name:'Mevcut işlemi bağla',exact:true}).click();
  await expect(page.getByText('Mevcut işlem bağlandı; yeni gelir/gider kaydı oluşturulmadı.')).toBeVisible();
  await expect(occurrence).toContainText('Kayıtlı işleme bağlı');
  await expect(occurrence).toContainText('E2E takvim gerçek ödeme');
  await expect(page.locator('.calendar-day.selected')).toContainText('bağlı');
  const transactionCount=async()=> (await (await page.request.get('/api/transactions')).json()).filter(item=>item.description==='E2E takvim gerçek ödeme').length;
  expect(await transactionCount()).toBe(1);

  const activePlan=page.locator('.plan-management .event-row').filter({hasText:'E2E takvim faturası'});
  await expect(activePlan).toContainText('3 ay · her ay');
  await activePlan.getByRole('button',{name:'Düzenle',exact:true}).click();
  await page.getByLabel('Plan başlığı',{exact:true}).fill('E2E takvim düzenlenmiş plan');
  await page.getByRole('button',{name:'Planı kaydet',exact:true}).click();
  const editedPlan=page.locator('.plan-management .event-row').filter({hasText:'E2E takvim düzenlenmiş plan'});
  await expect(editedPlan).toBeVisible();
  await expect(occurrence).toContainText('Kayıtlı işleme bağlı');
  await editedPlan.getByRole('button',{name:'Planı kaldır',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Planı kaldır',exact:true}).click();
  await expect(editedPlan).toHaveCount(0);
  expect(await transactionCount()).toBe(1);
  await page.getByRole('button',{name:'Nakit akışı',exact:true}).click();
  await expect(page.getByText('Yeterli geçmiş yok',{exact:true})).toBeVisible();
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
});
