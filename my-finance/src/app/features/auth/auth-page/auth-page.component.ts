import { AfterViewChecked, Component, ElementRef, EventEmitter, Output, ViewChild, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthUser } from '../../../core/models/finance.models';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports:[FormsModule],
  templateUrl: './auth-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './auth-page.component.scss',
})
export class AuthPageComponent implements AfterViewChecked {
  readonly auth = inject(AuthService);
  @ViewChild('googleButton') private googleButton?: ElementRef<HTMLDivElement>;
  @Output() signedIn = new EventEmitter<AuthUser>();
  @Output() back = new EventEmitter<void>();
  mfaCode='';
  mfaSubmitting=false;

  ngAfterViewChecked(): void {
    if (this.googleButton) {
      this.auth.renderGoogleButton(this.googleButton.nativeElement, credential => {
        this.auth.signInWithGoogle(credential).subscribe({ next: result => {
          if(result.mfaRequired)this.auth.mfaChallengeRequired=true;
          else if(result.user)this.signedIn.emit(result.user);
        } });
      });
    }
  }

  verifyMfa():void {
    if(this.mfaCode.trim().length<6||this.mfaSubmitting)return;
    this.mfaSubmitting=true;
    this.auth.verifyMfa(this.mfaCode).subscribe({next:user=>this.signedIn.emit(user),complete:()=>this.mfaSubmitting=false,error:()=>this.mfaSubmitting=false});
  }
}
