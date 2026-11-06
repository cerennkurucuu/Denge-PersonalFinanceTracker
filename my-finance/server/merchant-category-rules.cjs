const rules = [
  { category: ['market', 'market ve gıda', 'gıda'], terms: ['migros', 'carrefoursa', 'carrefour', 'a101', 'bim', 'sok market', 'şok market', 'file market', 'macrocenter', 'metro market'] },
  { category: ['restoran', 'yeme içme', 'yemek'], terms: ['starbucks', 'kahve dunyasi', 'kahve dünyası', 'mcdonald', 'burger king', 'getir yemek', 'yemeksepeti', 'trendyol yemek', 'dominos', 'pizzahut'] },
  { category: ['ulaşım', 'ulasim'], terms: ['shell', 'opet', 'petrol ofisi', 'bp turkey', 'totalenergies', 'uber', 'bitaksi', 'istanbulkart'] },
  { category: ['abonelik', 'dijital hizmetler'], terms: ['netflix', 'spotify', 'youtube premium', 'disney plus', 'amazon prime', 'apple services'] },
  { category: ['faturalar', 'fatura'], terms: ['turkcell', 'vodafone', 'turk telekom', 'elektrik', 'dogalgaz', 'doğalgaz', 'iski', 'su faturasi', 'internet faturasi'] },
  { category: ['maaş', 'maas', 'salary'], terms: ['maas', 'maaş', 'salary', 'bordro'] },
];

function normalizeMerchant(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('tr-TR').replace(/[ıİ]/g, 'i')
    .replace(/\b(iban|hesap|kart|card|account|ref|referans|islem no|transaction id)\b[^\s,;]*/gi, ' ')
    .replace(/\b\d{8,}\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120);
}

function guessCategory(description, type, categories) {
  const normalized = normalizeMerchant(description);
  if (!normalized) return { category: null, confidence: 'low', merchant: null, rule: null };
  const match = rules.find(rule => rule.terms.some(term => normalized.includes(normalizeMerchant(term))));
  if (!match) return { category: null, confidence: 'low', merchant: normalized, rule: null };
  const aliases = match.category.map(normalizeMerchant);
  const category = categories.find(item => item.type === type && aliases.includes(normalizeMerchant(item.name)));
  return { category: category || null, confidence: category ? 'high' : 'medium', merchant: normalized, rule: match.category[0] };
}

module.exports = { normalizeMerchant, guessCategory, rules };
