/** Leaving the app, for example to approve something on PayPal. Wrapped so tests can watch it. */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
