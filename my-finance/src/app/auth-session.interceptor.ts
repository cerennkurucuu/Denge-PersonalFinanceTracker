import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

let redirectingForExpiredSession = false;
const publicAuthEndpoints = ['/api/auth/config', '/api/auth/google', '/api/auth/me', '/api/auth/logout', '/api/auth/mfa/verify'];

export const authSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const protectedRequest = request.url.startsWith('/api/') && !publicAuthEndpoints.includes(request.url);
  return next(request).pipe(catchError((error: unknown) => {
    if (protectedRequest && error instanceof HttpErrorResponse && error.status === 401 && !redirectingForExpiredSession) {
      redirectingForExpiredSession = true;
      window.location.reload();
    }
    return throwError(() => error);
  }));
};
