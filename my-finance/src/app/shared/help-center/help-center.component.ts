import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FinancePage } from '../../core/models/finance.models';

interface PageGuide { title: string; summary: string; steps: string[]; note: string; doc: string; gif: string; }
const guides: Record<FinancePage, PageGuide> = {
  dashboard:{title:'Genel Bakış',summary:'Bakiye ve son dönemdeki hareketleri tek ekranda incele.',steps:['Bakiye ve gelir-gider özetinin dönemini kontrol et.','Aylık akış ve kategori grafiklerini karşılaştır.','Son işlemlerden bir kaydı aç veya Yeni işlem ile kayıt ekle.'],note:'Bakiye, kaydedilmiş gelir ve giderlerden hesaplanır. Gelecek planları gerçek bakiyeye eklenmez.',doc:'dashboard',gif:'dashboard'},
  transactions:{title:'İşlemler',summary:'Gerçekleşen gelir ve giderlerini burada yönet.',steps:['Yeni işlem ile tutar, yön, kategori ve tarih gir.','Ekstre aktarımında önce önizle; belirsiz veya mükerrer satırları gözden geçir.','Filtrele, satırları seç, düzenle veya dışa aktar.'],note:'Planlanan ödemeler bu listeye otomatik gerçek gider olarak eklenmez.',doc:'transactions',gif:'transactions'},
  plans:{title:'Planlarım',summary:'Düzenli gelir ve giderleri, gerçekleşmiş işlemlerden ayrı planla.',steps:['Yeni plan oluşturup yönü, tutarı ve tekrar tarihlerini seç.','Ay içindeki bekleyen ve gerçekleşmiş eşleşmeleri birlikte incele.','Planı düzenle veya kaldır; geçmişteki bağlı işlemler korunur.'],note:'Planlanan tutar nakit akışı tahminidir; bankada gerçekleşmiş hareket anlamına gelmez.',doc:'plans',gif:'plans'},
  savings:{title:'Birikim hedefleri',summary:'Hedef tutarını, gerçek katkıları ve ilerlemeyi takip et.',steps:['Hedef adı, hedef tutarı ve hedef tarihini belirle.','Gerçek para ayırdığında katkı kaydı oluştur.','Hedefler arası aktarım ve hareket geçmişini kullan.'],note:'Planlanan aylık katkı hedef önerisidir; katkı kaydı yapılana kadar gerçekleşmiş birikim sayılmaz.',doc:'savings',gif:'savings'},
  cashflow:{title:'Nakit akışı',summary:'Mevcut işlem bakiyeni tarihli planlarınla birlikte ileriye dönük incele.',steps:['7, 30 veya 90 günlük görünümü seç.','Yaklaşan plan ve ödemelerin tarihlerini kontrol et.','Tahmini tutarları gerçekleşmiş işlem tutarlarından ayrı değerlendir.'],note:'Başlangıç bakiyesi işlem kayıtlarından gelir. Tarihi olmayan hedef katkısı nakit akışında tarihli ödeme olarak görünmez.',doc:'cashflow',gif:'cashflow'},
  calendar:{title:'Finansal takvim',summary:'Ödeme ve gelir planlarını takvim üzerinde gör.',steps:['Bir gün seçerek planlanan kayıt ekle.','Tekrarlama sıklığı ve bitiş tarihini belirle.','Gerçekleşen işlemi ilgili plan oluşumuna bağla.'],note:'Bağlanan işlem, aynı ödemenin iki defa sayılmasını önler.',doc:'calendar',gif:'calendar'},
  reports:{title:'Raporlar',summary:'Gerçekleşmiş finansal kayıtları dönem ve kategoriye göre analiz et.',steps:['Başlangıç ve bitiş tarihini belirle.','Gelir, gider, net tutar ve grafik dağılımını incele.','CSV indir veya ilgili toplamı ayrı yenile.'],note:'Planlanan tutarlar gerçek işlem raporlarına gelir/gider olarak katılmaz.',doc:'reports',gif:'reports'},
  categories:{title:'Kategoriler',summary:'İşlemlerinin sınıflandırılacağı gelir ve gider kategorilerini yönet.',steps:['Gelir ya da gider sekmesini seç.','Kategori oluştururken ad, renk ve simge belirle.','Kullanılmayan kategoriyi düzenle veya kaldır.'],note:'Bir kategoriye bağlı işlemler varsa silme öncesi uygulamanın uyarısını kontrol et.',doc:'categories',gif:'categories'},
  settings:{title:'Ayarlar',summary:'Oturum güvenliği ve içe aktarma tercihlerini düzenle.',steps:['Oturum zaman aşımını ihtiyacına göre ayarla.','İki adımlı doğrulamayı yapılandır.','Mükerrer içe aktarma seçeneğinin açıklamasını okuyup tercihini belirle.'],note:'Güvenlik tercihlerini yalnızca kendi hesabın için değiştirirsin.',doc:'settings',gif:'settings'},
};

@Component({selector:'app-help-center',standalone:true,imports:[CommonModule],templateUrl:'./help-center.component.html',styleUrl:'./help-center.component.scss',changeDetection:ChangeDetectionStrategy.OnPush})
export class HelpCenterComponent {
  @Input({required:true}) page!:FinancePage;
  @Output() close=new EventEmitter<void>();
  @Output() tour=new EventEmitter<void>();
  get guide():PageGuide{return guides[this.page];}
}
