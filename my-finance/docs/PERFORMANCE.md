# Veri doğruluğu ve performans

Finansal doğruluk, kullanıcı verisinin korunması ve uygulamanın sağlıklı çalışması bütün geliştirmelerde önceliklidir. Daha hızlı görünmesi için doğrulama atlanmaz veya verinin bir kısmı sessizce rapordan çıkarılmaz.

- Tarih değerleri tutar olarak kabul edilmez. Başlıksız dosyada birden fazla tutar adayı varsa satır otomatik eşleştirilmez.
- Mevcut hatalı veriler kaynak ekstre doğrulanmadan değiştirilmez. Rapor veri bütünlüğü uyarısı verir.
- Gelir ve gider toplamları ayrı, kullanıcıya ve tarih aralığına bağlı SQL sorgularıyla yenilenir. Birini yenilemek diğerini veya plan motorunu çalıştırmaz.
- Eski rapor istekleri iptal edilir; gecikmiş yanıt yeni filtre sonucunun üzerine yazılmaz.
- İçe aktarma en fazla 10.000 satır ve 10 MB dosya kabul eder. Önizleme sayfa başına 50 satır gösterir.
- Kategori ve mükerrer kontrolleri satır başına sorgu çalıştırmaz. İşlemler 250 satırlık prepared statement gruplarıyla tek transaction içinde kaydedilir. Loglar INSERT SELECT ile yazılır.
- Aynı kullanıcının eş zamanlı içe aktarımları kullanıcı satırı kilidiyle sıralanır. Diğer kullanıcıların aktarımı bağımsızdır.
- 300 farklı döviz/tarih çiftini aşan dosyalarda otomatik kur sınırı açıkça gösterilir. Kur uydurulmaz.
- Analiz 100.000 kayıt sınırını aşarsa hata verir; sessizce ilk 10.000 kayıtla sonuç üretmez.

## Ücretsiz teknoloji değerlendirmesi

Mevcut Angular, Node.js, Express, mysql2 ve MySQL/InnoDB yeterlidir. Bu aşamada yeni ORM, Redis veya kuyruk servisi eklemek mevcut satır başına sorgu sorununu çözmez; ek işletim yükü getirir. Önce toplu SQL, indekslenebilir sorgular, sınırlı DOM ve ölçüm uygulanır. Ağır dosya ayrıştırması için Web Worker sonraki profil ölçümlerine göre değerlendirilebilir.

Resmî kaynaklar: [MySQL toplu INSERT](https://dev.mysql.com/doc/refman/8.0/en/insert-optimization.html), [InnoDB veri yükleme](https://dev.mysql.com/doc/refman/8.0/en/optimizing-innodb-bulk-data-loading.html), [Angular performans](https://angular.dev/best-practices/performance), [Angular Web Workers](https://angular.dev/ecosystem/web-workers).

## Ölçüm

10.000 sentetik TRY işleminin gerçek test MySQL ortamındaki aktarım isteği yaklaşık 3,6 saniye sürdü. Test, kayıt sayısını, 10.000 kur logunu ve 59.995.000 kuruş toplamını doğrular; test hesabı temizlenir. Bu bir hizmet seviyesi garantisi değildir. PDF ayrıştırma ve TCMB ağ istekleri bu süreye dahil değildir.
