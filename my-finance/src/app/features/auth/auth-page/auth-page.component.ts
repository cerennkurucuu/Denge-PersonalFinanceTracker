import { AfterViewChecked, Component, ElementRef, EventEmitter, Output, ViewChild, inject } from '@angular/core';
import { AuthUser } from '../../../core/models/finance.models';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
})
export class AuthPageComponent implements AfterViewChecked {
  readonly auth = inject(AuthService);
  @ViewChild('googleButton') private googleButton?: ElementRef<HTMLDivElement>;
  @Output() signedIn = new EventEmitter<AuthUser>();

  ngAfterViewChecked(): void {
    if (this.googleButton) {
      this.auth.renderGoogleButton(this.googleButton.nativeElement, credential => {
        this.auth.signInWithGoogle(credential).subscribe({ next: user => this.signedIn.emit(user) });
      });
    }
  }
}
