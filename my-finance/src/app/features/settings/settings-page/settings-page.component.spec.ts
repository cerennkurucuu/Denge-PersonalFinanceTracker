import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { FinanceApiService } from '../../../core/services/finance-api.service';
import { SettingsPageComponent } from './settings-page.component';

describe('SettingsPageComponent', () => {
  let fixture: ComponentFixture<SettingsPageComponent>;
  let finance: { allowDuplicateImports: boolean; settingsSaving: boolean; sessionTimeoutMinutes:number; setAllowDuplicateImports: jasmine.Spy; setSessionTimeoutMinutes:jasmine.Spy };

  beforeEach(async () => {
    finance = { allowDuplicateImports: false, settingsSaving: false, sessionTimeoutMinutes:10, setAllowDuplicateImports: jasmine.createSpy('setAllowDuplicateImports'), setSessionTimeoutMinutes:jasmine.createSpy('setSessionTimeoutMinutes') };
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [{ provide: FinanceStoreService, useValue: finance },{provide:FinanceApiService,useValue:{getMfaStatus:()=>of({enabled:false})}}],
    }).compileComponents();
    fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
  });

  it('shows duplicate matching criteria and leaves duplicate imports disabled by default', () => {
    const toggle = fixture.nativeElement.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(fixture.nativeElement.textContent).toContain('tarihi, yönü, para birimi, orijinal tutar');
    expect(fixture.nativeElement.textContent).toContain('Silmiş olduğun bir işlemi');
  });

  it('saves the opt-in when the switch is turned on', () => {
    const toggle = fixture.nativeElement.querySelector('[role="switch"]') as HTMLButtonElement;
    toggle.click();
    expect(finance.setAllowDuplicateImports).toHaveBeenCalledOnceWith(true);
  });

  it('offers the 10-minute default and persists a changed idle timeout',()=>{
    const input=fixture.nativeElement.querySelector('#session-timeout') as HTMLInputElement;
    expect(input.value).toBe('10');
    input.value='30';input.dispatchEvent(new Event('change'));
    expect(finance.setSessionTimeoutMinutes).toHaveBeenCalledOnceWith(30);
  });

  it('explains that Authenticator MFA protects Denge separately from Google account 2FA',()=>{
    expect(fixture.nativeElement.textContent).toContain('Bu, Google hesabının 2FA ayarını değiştirmez');
    expect(fixture.nativeElement.textContent).toContain('Authenticator uygulamasını kur');
  });
});
