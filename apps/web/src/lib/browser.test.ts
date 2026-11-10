import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from './browser';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening another tab', () => {
  it('opens a tab at once, then shows the page cut off from the app', () => {
    const tab = {
      opener: window as Window | null,
      location: { href: '' },
      close: vi.fn(),
      document: { title: '', body: { textContent: '' } },
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const pending = browser.openTab('Opening PayPal…');
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.document.body.textContent).toBe('Opening PayPal…');
    pending!.go('https://www.sandbox.paypal.com/invoice/p/#INV2');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://www.sandbox.paypal.com/invoice/p/#INV2');
  });

  it('says so when the browser blocks it', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(browser.openTab('Opening PayPal…')).toBeNull();
  });
});
