# Denge — Kişisel Finans Takipçisi

Denge, Türkçe arayüzlü bir kişisel finans takip uygulamasıdır. Gelir ve giderleri kuruş hassasiyetinde kaydeder, bakiyeyi işlem kayıtlarından hesaplar ve finansal hareketleri özetler.

## Özellikler

- Gelir ve gider ekleme, düzenleme, silme ve türe göre filtreleme
- Hazır kategoriler ve kullanıcı kategorileri
- Bakiye, aylık gelir/gider, son işlemler ve kategori harcama özeti
- Aylık ve yıllık raporlar, CSV dışa aktarma
- Açık/koyu tema; responsive masaüstü ve mobil arayüz
- Kalıcı SQLite depolama ve API doğrulaması

## Teknolojiler ve mimari

- Angular 19, TypeScript, SCSS, Angular Forms ve HttpClient
- Express.js REST API, Node.js ve `better-sqlite3`
- SQLite migration dosyaları `server/migrations/` altında bulunur. Tutarlar integer kuruş olarak saklanır; bakiye ayrı bir tabloda tutulmaz.
- İstemci tarafı rendering kullanılır. Angular SSR kaldırılmıştır; sunucu uygulaması Express API ve production statik dosyalarını sunar.
- Aylık gelir/gider ve kategori dağılımı grafikleri responsive Chart.js bileşenleriyle çizilir.

## Gereksinimler

- Node.js 18 veya üzeri
- npm

## Kurulum ve çalıştırma

```bash
npm install
npm start
```

`npm start` Express API’yi ve Angular geliştirme sunucusunu birlikte başlatır. Uygulama genellikle `http://localhost:4200`, API `http://localhost:3000/api` adresindedir. 4200 portu doluysa kullanılabilir sonraki port seçilir ve terminalde gösterilir. SQLite dosyası ilk API başlangıcında `data/finance.sqlite` konumunda oluşturulur ve Git dışında tutulur. İstemciyi tek başına çalıştırmak için `npm run start:client`; API’yi tek başına çalıştırmak için `npm run start:api` kullanın. Production için önce `npm run build`, sonra `npm run start:prod` çalıştırın.

## REST API

| Method | Endpoint | Açıklama |
| --- | --- | --- |
| GET, POST | `/api/transactions` | İşlemleri listele veya ekle; `from`, `to`, `type` filtreleri kullanılabilir |
| PUT, DELETE | `/api/transactions/:id` | İşlemi güncelle veya sil |
| GET, POST | `/api/categories` | Kategorileri listele veya ekle |
| PUT, DELETE | `/api/categories/:id` | Kullanıcı kategorisini düzenle veya sil |
| GET | `/api/dashboard/summary` | Bakiye, dönem özeti ve son işlemler |
| GET | `/api/reports/monthly?year=2026` | Aylık gelir/gider toplamları (kuruş) |
| GET | `/api/reports/yearly` | Yıllık gelir/gider toplamları (kuruş) |
| GET, PUT | `/api/settings` | Para birimi, tema ve dil ayarları |

İşlem oluşturma örneği (`amount` kuruş cinsindedir):

```json
{
  "type": "Expense",
  "amount": 12550,
  "description": "Market alışverişi",
  "category_id": 1,
  "transaction_date": "2026-06-15"
}
```

## Test ve build

```bash
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
npm run test:api
```

API testleri Supertest ve Node test runner kullanır. Tarayıcı testleri Angular Karma/Jasmine altyapısını kullanır.

## Ekran görüntüleri

> Dashboard, işlem listesi ve mobil görünüm ekran görüntüleri eklenecek.

## Proje yapısı

```text
src/                 Angular uygulaması
server/index.cjs     Express API ve SQLite erişimi
server/migrations/   SQLite şema migration'ları
server/tests/        REST API entegrasyon testleri
```
