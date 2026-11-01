import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });

  it('renders the Turkish Denge finance dashboard', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('Denge');
    expect(compiled.querySelector('h1')?.textContent).toContain('Merhaba, Ceren');
    expect(compiled.querySelector('nav')?.textContent).toContain('İşlemler');
  });

  it('formats Turkish lira amounts with comma decimals', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(component.fmt(123456)).toContain('1.234,56');
  });

  it('converts decimal amounts to kuruş without floating-point rounding', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(component.toCents('1.01')).toBe(101);
    expect(component.toCents('1,5')).toBe(150);
    expect(component.toCents('1.005')).toBeNull();
  });
});
