/** A tab opened at the person's click, before the page it will show is known. */
export interface PendingTab {
  /** Shows the page, cut off from this app. */
  go: (url: string) => void;
  close: () => void;
}

/** Leaving the app or opening another tab, for example on PayPal. Wrapped so tests can watch it. */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },

  /**
   * Opens an empty tab now, while the click still counts, so the browser doesn't block it when
   * the address arrives from the server later. Null if the browser blocked it anyway.
   */
  openTab(placeholder: string): PendingTab | null {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    try {
      tab.document.title = placeholder;
      tab.document.body.textContent = placeholder;
    } catch {
      // The placeholder is a courtesy; the tab works without it.
    }
    return {
      go(url) {
        tab.opener = null;
        tab.location.href = url;
      },
      close() {
        tab.close();
      },
    };
  },
};
