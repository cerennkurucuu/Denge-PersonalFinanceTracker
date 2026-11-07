import { NgZone, Injectable, inject } from '@angular/core';
import { catchError, finalize, forkJoin, map, Observable, of, Subject, tap } from 'rxjs';
import { AuthUser } from '../models/finance.models';
import { FinanceApiService } from './finance-api.service';

interface GoogleCredentialResponse { credential: string; }
interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global { interface Window { google?: GoogleIdentityApi; } }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(FinanceApiService);
  private readonly zone = inject(NgZone);

  loading = true;
  error = '';
  googleClientId: string | null = null;
  mfaChallengeRequired = false;
  readonly sessionExpired$ = new Subject<void>();
  private googleScriptLoading = false;
  private googleRenderedFor = '';
  private idleTimeoutMinutes=10;
  private idleTimer:ReturnType<typeof setTimeout>|null=null;
  private lastActivityAt=0;
  private lastActivitySyncAt=0;
  private sessionActive=false;
  private readonly onActivity=()=>{if(this.sessionActive){this.lastActivityAt=Date.now();this.scheduleIdleTimeout();if(Date.now()-this.lastActivitySyncAt>=60_000){this.lastActivitySyncAt=Date.now();this.api.touchSession().subscribe({error:()=>undefined});}}};
  private readonly onVisibility=()=>{if(this.sessionActive&&document.visibilityState==='visible')this.checkIdleTimeout();};

  initialize(): Observable<AuthUser | null> {
    this.loading = true;
    this.error = '';
    return forkJoin({
      config: this.api.getGoogleConfig().pipe(catchError(() => {
        this.error = 'Giriş ayarları alınamadı. Sunucunun çalıştığından emin olun.';
        return of({ googleClientId: null });
      })),
      session: this.api.getCurrentUser().pipe(
        map(response => response.user),
        catchError(response => {
          if (response.status !== 401) this.error = 'Oturum bilgisi alınamadı. Yeniden deneyin.';
          return of(null);
        }),
      ),
    }).pipe(
      tap(result => { this.googleClientId = result.config.googleClientId; }),
      map(result => result.session),
      finalize(() => this.loading = false),
    );
  }

  renderGoogleButton(host: HTMLElement, onCredential: (credential: string) => void): void {
    if (!this.googleClientId || this.googleRenderedFor === this.googleClientId) return;
    if (window.google) {
      this.drawGoogleButton(host, onCredential);
      return;
    }
    if (this.googleScriptLoading) return;
    this.googleScriptLoading = true;
    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => this.zone.run(() => this.drawGoogleButton(host, onCredential));
    script.onerror = () => this.zone.run(() => { this.error = 'Google giriş aracı yüklenemedi. İnternet bağlantını kontrol et.'; });
    document.head.appendChild(script);
  }

  signInWithGoogle(credential: string): Observable<{ user?: AuthUser; mfaRequired?: boolean }> {
    this.error = '';
    return this.api.signIn(credential).pipe(
      tap({ error: response => this.error = response.status === 0
        ? 'Giriş sunucusuna ulaşılamadı. Uygulamayı npm start ile açıp sayfayı yenileyin.'
        : response.error?.error || 'Google ile giriş yapılamadı.' }),
    );
  }

  verifyMfa(code:string):Observable<AuthUser> {
    this.error='';
    return this.api.verifyMfa(code).pipe(
      map(response=>response.user),
      tap({error:response=>this.error=response.error?.error||'İki adımlı doğrulama yapılamadı.'}),
      tap(()=>{this.mfaChallengeRequired=false;}),
    );
  }

  signOut(): Observable<void> {
    return this.api.signOut().pipe(tap(()=>this.endSession()));
  }

  startSession(timeoutMinutes:number):void {
    this.endSession();
    this.sessionActive=true;
    this.idleTimeoutMinutes=this.validIdleTimeout(timeoutMinutes);
    this.lastActivityAt=Date.now();
    this.lastActivitySyncAt=this.lastActivityAt;
    for(const event of ['pointerdown','keydown','touchstart','scroll'])window.addEventListener(event,this.onActivity,{passive:true});
    document.addEventListener('visibilitychange',this.onVisibility);
    this.scheduleIdleTimeout();
  }

  updateIdleTimeout(timeoutMinutes:number):void {
    this.idleTimeoutMinutes=this.validIdleTimeout(timeoutMinutes);
    if(this.sessionActive)this.scheduleIdleTimeout();
  }

  endSession():void {
    this.sessionActive=false;
    if(this.idleTimer)clearTimeout(this.idleTimer);
    this.idleTimer=null;
    for(const event of ['pointerdown','keydown','touchstart','scroll'])window.removeEventListener(event,this.onActivity);
    document.removeEventListener('visibilitychange',this.onVisibility);
  }

  private validIdleTimeout(value:number):number {return Number.isInteger(value)&&value>=1&&value<=480?value:10;}
  private scheduleIdleTimeout():void {
    if(this.idleTimer)clearTimeout(this.idleTimer);
    this.idleTimer=setTimeout(()=>this.checkIdleTimeout(),Math.max(0,this.idleTimeoutMinutes*60_000-(Date.now()-this.lastActivityAt)));
  }
  private checkIdleTimeout():void {
    if(!this.sessionActive)return;
    const remaining=this.idleTimeoutMinutes*60_000-(Date.now()-this.lastActivityAt);
    if(remaining>0){this.scheduleIdleTimeout();return;}
    this.endSession();
    this.error='Hareketsizlik nedeniyle oturum kapatıldı. Devam etmek için Google hesabınla yeniden giriş yap.';
    this.api.signOut().subscribe({error:()=>undefined});
    this.sessionExpired$.next();
  }

  resetGoogleButton(): void {
    this.googleRenderedFor = '';
  }

  private drawGoogleButton(host: HTMLElement, onCredential: (credential: string) => void): void {
    if (!window.google || !this.googleClientId || this.googleRenderedFor === this.googleClientId) return;
    window.google.accounts.id.initialize({
      client_id: this.googleClientId,
      callback: response => this.zone.run(() => onCredential(response.credential)),
    });
    window.google.accounts.id.renderButton(host, {
      theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'tr', width: 280,
    });
    this.googleRenderedFor = this.googleClientId;
  }
}
