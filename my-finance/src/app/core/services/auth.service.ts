import { NgZone, Injectable, inject } from '@angular/core';
import { catchError, finalize, forkJoin, map, Observable, of, tap } from 'rxjs';
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
  private googleScriptLoading = false;
  private googleRenderedFor = '';

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

  signInWithGoogle(credential: string): Observable<AuthUser> {
    this.error = '';
    return this.api.signIn(credential).pipe(
      map(response => response.user),
      tap({ error: response => this.error = response.status === 0
        ? 'Giriş sunucusuna ulaşılamadı. Uygulamayı npm start ile açıp sayfayı yenileyin.'
        : response.error?.error || 'Google ile giriş yapılamadı.' }),
    );
  }

  signOut(): Observable<void> {
    return this.api.signOut();
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
