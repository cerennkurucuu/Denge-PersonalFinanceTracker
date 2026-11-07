import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { FinanceStoreService } from '../../../core/services/finance-store.service';
import { FinanceApiService } from '../../../core/services/finance-api.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SettingsPageComponent implements OnInit {
  readonly finance = inject(FinanceStoreService);
  private readonly api=inject(FinanceApiService);
  mfaEnabled=false;
  mfaSecret='';
  mfaUri='';
  mfaCode='';
  mfaMessage='';
  mfaError='';
  recoveryCodes:string[]=[];
  mfaBusy=false;

  ngOnInit():void {this.api.getMfaStatus().subscribe({next:result=>this.mfaEnabled=result.enabled,error:()=>this.mfaError='İki adımlı doğrulama durumu yüklenemedi.'});}

  toggleDuplicateImports(): void {
    this.finance.setAllowDuplicateImports(!this.finance.allowDuplicateImports);
  }

  setSessionTimeout(value:string):void {
    this.finance.setSessionTimeoutMinutes(Number(value));
  }

  beginMfaSetup():void {
    this.mfaBusy=true;this.mfaError='';this.mfaMessage='';
    this.api.setupMfa().subscribe({next:result=>{this.mfaSecret=result.secret;this.mfaUri=result.otpauthUri;this.mfaCode='';},error:response=>{this.mfaError=response.error?.error||'Doğrulama kurulumu başlatılamadı.';this.mfaBusy=false;},complete:()=>this.mfaBusy=false});
  }

  confirmMfaSetup():void {
    if(!/^\d{6}$/.test(this.mfaCode)||this.mfaBusy)return;
    this.mfaBusy=true;this.mfaError='';this.mfaMessage='';
    this.api.enableMfa(this.mfaCode).subscribe({next:result=>{this.mfaEnabled=true;this.recoveryCodes=result.recoveryCodes;this.mfaSecret='';this.mfaUri='';this.mfaCode='';this.mfaMessage='İki adımlı doğrulama etkinleştirildi. Yedek kodları şimdi güvenli bir yerde sakla; tekrar gösterilmeyecek.';},error:response=>{this.mfaError=response.error?.error||'Doğrulama etkinleştirilemedi.';this.mfaBusy=false;},complete:()=>this.mfaBusy=false});
  }

  disableMfa():void {
    if(!/^\d{6}$/.test(this.mfaCode)||this.mfaBusy)return;
    this.mfaBusy=true;this.mfaError='';this.mfaMessage='';
    this.api.disableMfa(this.mfaCode).subscribe({next:()=>{this.mfaEnabled=false;this.recoveryCodes=[];this.mfaCode='';this.mfaMessage='İki adımlı doğrulama kapatıldı.';},error:response=>{this.mfaError=response.error?.error||'Doğrulama kapatılamadı.';this.mfaBusy=false;},complete:()=>this.mfaBusy=false});
  }
}
