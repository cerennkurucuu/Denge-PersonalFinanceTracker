# Finansal takvim ve nakit akışı

Takvim, mevcut Denge temasını ve gelir/gider kayıtlarını kullanır. `calendar-page` ayrı yüklenir; takvim açılmadığında takvim veya tahmin sorguları çalışmaz. Yeni ücretli servis, banka bağlantısı veya harici tahmin API'si yoktur.

## Planlar ve gerçekleşmeler

- Maaş, kira, fatura, kredi taksiti, kredi kartı son ödeme, abonelik, planlanan gelir/gider ve birikim ayırma desteklenir.
- Tutarlar TRY kuruşu olarak integer saklanır. Dövizli gerçekleşmiş işlemlerde mevcut kaydın daha önce hesaplanmış TRY tutarı kullanılır.
- Tek sefer, günlük, haftalık, aylık ve yıllık tekrarlar başlangıç gününe bağlıdır. Ayın 31'i şubatta son güne alınır; martta tekrar 31 olur. 29 Şubat yıllık tekrarında aynı yaklaşım kullanılır.
- Tekrarlar sanal olarak üretilir; her açılışta binlerce ödeme kaydı eklenmez.
- Gerçekleşen ödeme için kullanıcı mevcut işlem kimliğini bağlar. Bu işlem yeni gelir/gider yaratmaz. Bir gerçek işlem yalnızca tek plan tarihine bağlanabilir. Bağlantı kullanıcı ve işlem yönü bakımından doğrulanır; tarih farkı en fazla 31 gündür.
- Bir tutar/tarih/kategori eşleşmesi varsa kullanıcıya aday gösterilir. Kullanıcı bağlantıyı doğrulamadan tutarın iki kez düşülmesine yol açacak bakiye projeksiyonu üretilmez.
- Birikim ayırma, tüketim gideri oluşturmaz; yalnızca kullanılabilir tutarı azaltır. İşaretleme kaldırıldığında ayrılan tutar serbest bırakılır.
- Plan kaldırma arşivleme yapar. Kayıtlı işlemler ve tamamlanmış tarihlerin başlık/tutar anlık görüntüleri korunur. Ayrılmış birikim otomatik serbest bırakılmaz; kullanıcı ilgili işaretlemeyi kaldırır.
- Gerçek işlemin silinmesi bağlantı işaretlemesini kaldırır. Aktif plan tarihi tekrar bekleyen duruma döner. Takvimden işaretleme kaldırmak gerçek işlemi silmez.

## Tahmin yöntemi

1. Bugüne kadar gerçekleşmiş kayıtların neti hesaplanır. İleri tarihli kayıtlar mevcut bakiye içinde kabul edilmez.
2. Kullanıcının ayırdığı birikimler kullanılabilir tutardan düşülür.
3. Bekleyen planlar ve ileri tarihli kayıtlı işlemler kendi tarihlerinde bir kez uygulanır. Gecikmiş giderler bugünkü ödeme yüküne taşınır. Gecikmiş gelirler bugün alınmış varsayılmaz.
4. Son 90 günlük geçmişte en az 12 değişken gider, en az 6 aktif hafta ve dönem başına uzanan kayıt varsa sınırlı güvenli değişken harcama tahmini oluşturulur. Bu bir garanti değildir.
5. Kullanıcının sabit olarak işaretlediği gider kategorileri ve bağlanmış sabit ödemeler günlük ortalamaya katılmaz. Aynı işyerinde üç benzer tutarlı, 26–35 gün aralıklı geçmiş ödeme varsa bunlar da günlük harcamaya yayılmaz. Takvime alınmamış bu düzenli giderler varsa eksik plan uyarısı verilir ve harcamaya dayalı bakiye tahmini üretilmez.
6. Bugünkü harcamalar açılış bakiyesinde olduğundan tekrar tahmin edilmez. Geleceğe ait bildirilen değişken ödemeler, geçmişten hesaplanan değişken harcama tabanının ilgili kısmını karşılar; aynı gider ikinci kez eklenmez.
7. 7/30/90 günlük dönem bugün dahil takvim günleridir. Ay sonu tutarı seçilen dönemden bağımsız hesaplanır. Sadece bildirilen akış ile geçmişe dayalı tahmin ayrı alanlardır.

Yetersiz geçmişte yalnızca **bildirilen planların** akışı gösterilir; tahmini harcama ve tahmini bakiye `null` döner. Belirsiz işlem eşleşmesinde ödeme/gelir yükü ve bakiye projeksiyonu durdurulur. Mevcut net bakiye gösterilebilir. Eski tarih/tutar içe aktarma hatası veya güvenli integer sınırının aşılması halinde açık hata verilir.

Takvimde yaklaşan ve gecikmiş planlar, ödeme yükü ve ilk negatif bakiye tarihi için uygulama içi uyarılar bulunur. Kapatılan uyarının kullanıcıya özel SHA-256 anahtarı saklanır; aynı uyarı sayfa yenilenince tekrar görünmez. İşletim sistemi bildirimi, e-posta veya arka planda banka sorgusu yapılmaz.

## API

Tüm uçlar mevcut Google oturumunu ve aynı kaynak korumasını kullanır. Kullanıcı kimliği istek gövdesinden alınmaz.

| Yöntem | Uç | İşlev |
|---|---|---|
| GET | `/api/calendar?from=2026-11-01&to=2026-11-30` | Planlanan ve kayıtlı hareketler |
| GET, POST | `/api/calendar/plans` | Aktif planlar / plan oluşturma |
| PUT, DELETE | `/api/calendar/plans/:id` | Düzenleme / arşivleme |
| POST | `/api/calendar/plans/:id/occurrences/:date` | `{action: "link", transactionId: 123}`, `{action: "reserve"}` veya `{action: "skip"}` |
| DELETE | `/api/calendar/plans/:id/occurrences/:date` | İşaretlemeyi geri alma |
| GET | `/api/cashflow?days=7` | 7, 30 veya 90 günlük nakit akışı |
| POST | `/api/calendar/alerts/:fingerprint/dismiss` | Uyarıyı kullanıcı için kapatma |

## Veri ve sınırlar

Migration `006-financial-calendar.sql` yalnızca `calendar_plans`, `calendar_occurrences` ve `calendar_alert_dismissals` tablolarını ekler. Mevcut finans kayıtları taşınmaz veya silinmez. Kullanıcı ve kategori/işlem sahipliği bileşik foreign key'lerle korunur.

En fazla 500 aktif plan desteklenir. Takvim sorgusu 366 günle sınırlıdır. 20.000 gerçekleşme/üretilen plan tarihi veya 100.000 gerçek işlem sınırında sessiz kesme yerine açıklayıcı hata verilir. Gün detayları 25 kayıtla sayfalanır; tahmin tablosu en fazla 90 satırdır.

## Doğrulama

- `npm run test:api`: tekrar kuralları, ay sonları, artık yıl, sabit giderler, yetersiz geçmiş, tek sayım, eski gelirler ve nakit yetersizliği.
- `npm run test:mysql`: takvim CRUD, kullanıcı izolasyonu, foreign key'ler, gerçek işlem bağlantısı, birikim ayırma ve kalıcı uyarı tercihleri.
- `npm run test:e2e`: takvim planı oluşturma, mevcut ödemeyi bağlama, düzenleme, kaldırma ve mobil görünüm.

MySQL testleri yalnızca `MYSQL_TEST_MODE=1` ve production olmayan ortamda çalışır; sentetik test hesapları temizlenir. Mevcut kullanıcı planları değiştirilmez.
