export const CATEGORY_ICON_OPTIONS = [
  { value: 'circle', label: 'Genel', symbol: '◉' },
  { value: 'basket', label: 'Market', symbol: '🛒' },
  { value: 'car', label: 'Ulaşım', symbol: '🚗' },
  { value: 'bolt', label: 'Faturalar', symbol: '⚡' },
  { value: 'heart', label: 'Sağlık', symbol: '♥' },
  { value: 'bag', label: 'Alışveriş', symbol: '🛍' },
  { value: 'sparkles', label: 'Eğlence', symbol: '✦' },
  { value: 'book', label: 'Eğitim', symbol: '▤' },
  { value: 'restaurant', label: 'Restoran', symbol: '🍽' },
  { value: 'home', label: 'Konut', symbol: '⌂' },
  { value: 'briefcase', label: 'Maaş', symbol: '▣' },
  { value: 'plus', label: 'Ek gelir', symbol: '+' },
  { value: 'laptop', label: 'Freelance', symbol: '▱' },
  { value: 'chart', label: 'Yatırım', symbol: '↗' },
  { value: 'paw', label: 'Evcil hayvan', symbol: '🐾' },
] as const;

export function categoryIconSymbol(value: string): string {
  return CATEGORY_ICON_OPTIONS.find(option => option.value === value)?.symbol ?? '◉';
}
