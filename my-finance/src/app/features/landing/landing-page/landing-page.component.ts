import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-landing-page', standalone: true, imports: [CommonModule],
  templateUrl: './landing-page.component.html', styleUrl: './landing-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent {
  @Output() enter = new EventEmitter<void>();
  readonly questions = [
    { q: 'Finansal bilgilerim nerede tutuluyor?', a: 'Kayıtların Denge hesabına bağlı olarak uygulamanın sunucusundaki veritabanında saklanır. Kullanıcı oturumu olmadan finans API’lerine erişilemez; ekstre dosyası tarayıcıda okunur ve sunucuya yüklenmez.' },
    { q: 'Banka hesabım otomatik bağlanıyor mu?', a: 'Hayır. Banka kullanıcı adı veya şifresi istenmez. İşlemlerini kendin ekleyebilir ya da ekstre dosyanı tarayıcıda inceleyip seçerek içe aktarabilirsin.' },
    { q: 'Dövizli işlemlerde kur nasıl belirleniyor?', a: 'EUR, USD ve GBP için işlem tarihine ait TCMB efektif alış kuru kullanılabilir. Kur bulunamazsa uygulama uydurma kur kullanmaz; gerekiyorsa kuru elle girebilirsin.' },
    { q: 'Planlanan ödeme hesabımdan düşer mi?', a: 'Hayır. Takvim ve plan kayıtları tahmini akışta görünür. Gerçekleşen işlemle bağlandığında aynı ödeme ikinci kez gider sayılmaz.' },
    { q: 'Uygulamayı kullanmak ücretli mi?', a: 'Denge’de ücretli yapay zekâ veya ücretli finans API’si kullanılmaz. Sunucu barındırma ve veritabanı maliyetleri ise uygulamanın dağıtıldığı ortama bağlı olabilir.' },
  ];
}
