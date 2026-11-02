# Denge — Kişisel Finans Takipçisi

Denge, Türkçe arayüzlü bir kişisel finans takip uygulamasıdır. Gelir ve giderleri kuruş hassasiyetinde kaydeder, bakiyeyi işlem kayıtlarından hesaplar ve finansal hareketleri özetler.

## Özellikler

- Gelir ve gider ekleme, düzenleme, silme, tür ve tarih aralığı filtreleme
- Hazır kategoriler ve kullanıcı kategorileri; gelir ve gider için ayrı işlem varsayılanı ve simge seçimi
- Bakiye, aylık gelir/gider, son işlemler ve kategori harcama özeti
- Aylık ve yıllık raporlar, tarih aralığına göre kategori analizi ve CSV dışa aktarma
- Açık/koyu tema; responsive masaüstü ve mobil arayüz
- Kalıcı MySQL depolama ve API doğrulaması
- Google hesabıyla giriş ve hesaplar arasında kullanıcıya özel veri ayrımı

## Teknolojiler ve mimari

- Angular 19, TypeScript, SCSS, Angular Forms ve HttpClient
- Express.js REST API, Node.js ve `mysql2` promise pool
- `google-auth-library` ile sunucu tarafında Google ID token doğrulaması
- Sürümlü MySQL şema migration’ları `server/migrations/mysql/` altında bulunur. Tutarlar integer kuruş olarak saklanır; bakiye ayrı bir tabloda tutulmaz.
- İstemci tarafı rendering kullanılır. Angular SSR kaldırılmıştır; sunucu uygulaması Express API ve production statik dosyalarını sunar.
- Aylık gelir/gider ve kategori dağılımı grafikleri responsive Chart.js bileşenleriyle çizilir.
- Kullanıcılar Google `sub` kimliğiyle tanımlanır. Her işlem, kategori ve ayar `user_id` ile sınırlandırılır; oturum kimlikleri veritabanında yalnızca SHA-256 özetiyle saklanır.

## Gereksinimler

- Node.js 18 veya üzeri
- npm

## Kurulum ve çalıştırma

```bash
npm install
npm start
```

`npm start` MySQL API’yi ve Angular geliştirme sunucusunu birlikte başlatır. Uygulama genellikle `http://localhost:4200`, API `http://localhost:3000/api` adresindedir. 4200 portu doluysa kullanılabilir sonraki port seçilir ve terminalde gösterilir. API başlangıcında sürümlü migration’lar gerekli tabloları oluşturur. İstemciyi tek başına çalıştırmak için `npm run start:client`; API’yi tek başına çalıştırmak için `npm run start:api` kullanın. Production için önce `npm run build`, sonra `npm run start:prod` çalıştırın.

### MySQL veritabanı

`.env.example` dosyasını `.env` olarak kopyalayın ve `MYSQL_HOST`, `MYSQL_PORT` (varsayılan `3306`), `MYSQL_DATABASE`, `MYSQL_USER` ve `MYSQL_PASSWORD` değerlerini yerel olarak doldurun. `.env` Git’e eklenmez. Uygulama başlangıcında `server/migrations/mysql/` altındaki migration’lar gerekli tabloları oluşturur. `MYSQL_SSL=true` TLS doğrulamasını açar; sağlayıcının özel CA dosyası gerekiyorsa `MYSQL_SSL_CA` yolunu belirtin. `NODE_EXTRA_CA_CERTS` Node.js’in ek sertifika deposudur; MySQL bağlantı adresi veya parolası değildir. Production ortamında TLS zorunludur. Sertifikasız test bağlantısında TLS kapalı bırakılabilir; gerçek finansal verileri şifrelenmemiş bağlantıda kullanmayın.

Bu sürüm SQLite kullanmaz. Önceden oluşmuş yerel SQLite dosyası varsa silinmez veya otomatik aktarılmaz; uygulama tarafından okunmaz. Eski kayıtlar gerekiyorsa ayrıca kontrollü, doğrulamalı aktarım gerekir.

### Google girişi

1. Google Cloud Console’da OAuth consent screen’i ayarlayın ve bir **Web application** OAuth Client ID oluşturun.
2. Yerel geliştirme için `http://localhost:4200` adresini authorized JavaScript origin olarak ekleyin. Geliştirme sunucusu başka porta geçerse o origin’i de Google ayarlarına ekleyin.
3. `my-finance/.env.example` dosyasını `my-finance/.env` olarak kopyalayıp `GOOGLE_CLIENT_ID` değerini girin; API’yi yeniden başlatın.
4. `APP_ORIGIN` production’da uygulamanın tam HTTPS origin’ine ayarlanmalıdır.

Google ID token’ı sunucuda imza, issuer, audience ve süre kontrollerinden geçmeden kullanıcı oturumu açılmaz. Oturum cookie’si `HttpOnly`, `SameSite=Lax` ve production’da `Secure` olur. Giriş yapılmadan finans API’leri 401 döndürür. Yeni hesaplar kendi varsayılan kategori ve ayarlarını alır; kullanıcılar başka hesapların işlemlerini, kategorilerini, raporlarını veya ayarlarını okuyamaz.

Kullanıcı ayrımı migration `002-user-ownership.sql` ile uygulanır. Eski tek kullanıcılı veriler migration sırasında silinmez; sahip atanmadan (`user_id IS NULL`) bırakılır ve hiçbir yeni oturumun API yanıtlarına dahil edilmez. Bu projede eski kayıtlar kullanıcı tarafından boş hesap tercihiyle kullanılmıyor.

## REST API

| Method | Endpoint | Açıklama |
| --- | --- | --- |
| GET | `/api/auth/config` | Google istemci kimliği yapılandırma durumu (public) |
| POST | `/api/auth/google` | Google ID token’ını doğrula ve oturum aç |
| GET | `/api/auth/me` | Oturum açmış kullanıcı (kimlik doğrulama gerekli) |
| POST | `/api/auth/logout` | Oturumu kapat |
| GET, POST | `/api/transactions` | İşlemleri listele veya ekle; `from`, `to`, `type` filtreleri kullanılabilir |
| PUT, DELETE | `/api/transactions/:id` | İşlemi güncelle veya sil |
| GET, POST | `/api/categories` | Kategorileri listele veya ekle |
| PUT, DELETE | `/api/categories/:id` | Kullanıcı kategorisini düzenle veya sil |
| PUT | `/api/categories/:id/preferred` | Bu kategori türü için varsayılan işlem kategorisini belirle |
| GET | `/api/dashboard/summary` | Bakiye, dönem özeti ve son işlemler |
| GET | `/api/reports/monthly?year=2026` | Aylık gelir/gider toplamları (kuruş) |
| GET | `/api/reports/yearly` | Yıllık gelir/gider toplamları (kuruş) |
| GET, PUT | `/api/settings` | Para birimi, tema ve dil ayarları |

Finans endpoint’leri Google oturum cookie’si olmadan kullanılamaz. İşlem oluşturma örneği (`amount` kuruş cinsindedir):

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
npm run test:e2e
```

MySQL entegrasyon testi yalnızca test veritabanında ve açıkça etkinleştirilerek çalıştırılır (PowerShell): `$env:MYSQL_TEST_MODE='1'; npm run test:mysql`. API ve E2E testleri de MySQL kullanır; test verileri rastgele kimlikli geçici kullanıcılarla sınırlandırılır ve test sonunda silinir. Bu testleri production veritabanında çalıştırmayın.

Google ID token birim testi Node test runner’ı, MySQL API ve E2E testleri Supertest/Playwright kullanır. Angular bileşen testleri Karma/Jasmine altyapısını kullanır.

## Ekran görüntüleri

### Genel bakış

![Denge dashboard ekranı](docs/screenshots/dashboard-desktop.png)

### Raporlar

![Denge raporlar ekranı](docs/screenshots/reports-desktop.png)

### Mobil işlemler

![Denge mobil işlem ekranı](docs/screenshots/transactions-mobile.png)

## Proje yapısı

```text
src/app/
  core/
    models/           Paylaşılan tipler ve veri modelleri
    services/         Auth, API, formatlama, grafik ve finans durumu servisleri
  features/
    auth/auth-page/                    Giriş ekranı
    dashboard/dashboard-page/          Genel bakış ve özet grafikleri
    transactions/transactions-page/   İşlem listesi ve filtreleri
    transactions/transaction-form/     İşlem ekleme/düzenleme formu
    categories/categories-page/        Gelir/gider kategori listeleri
    categories/category-form/          Kategori ekleme/düzenleme formu
    reports/reports-page/              Aylık/yıllık raporlar
  layout/
    sidebar/          Ana navigasyon ve kullanıcı profili
    topbar/           Sayfa başlığı ve hızlı eylemler
  shared/
    delete-confirmation/ Silme onay penceresi
  app.component.*    Oturum durumu ve sayfa bileşenlerini birleştiren kök kabuk
  auth-session.interceptor.ts  Oturum gerektiren API çağrıları
styles.scss          Renk token'ları, reset ve uygulama geneli temel stiller
    server/index.cjs     Express API ve MySQL bağlantı başlangıcı
    server/mysql-server.cjs  MySQL havuzu ve REST API
    server/migrations/mysql/ MySQL şema migration'ları
server/tests/        REST API entegrasyon testleri
```

Her sayfa ve form klasörü kendi `*.component.ts`, `*.component.html` ve `*.component.scss` dosyalarını içerir. Böylece bir ekranı değiştirmek için tüm uygulamanın tek HTML/SCSS dosyasını aramak gerekmez. `FinanceStoreService` ekranların işlem durumunu ve CRUD akışlarını; `FinanceApiService` HTTP erişimini; `FinanceFormatService` TRY, tarih ve kuruş dönüşümünü; `FinanceChartService` Chart.js yaşam döngüsünü; `AuthService` oturum akışını yönetir. `AppComponent` yalnızca oturum ve aktif sayfa koordinasyonunu yapar.
