/**
 * Minimal typed wrapper around Umami's client-side tracker.
 *
 * Umami is loaded via <Script> in the root layout from cloud.umami.is. It
 * attaches `window.umami.track(...)`. If the script is blocked (ad blockers,
 * hardened browsers), `window.umami` is undefined — we no-op silently.
 *
 * Three events only. Resist adding more.
 *
 *   roster_built          — first champion lands in an otherwise empty roster
 *                          (or a URL/OCR import populates one). Activation.
 *   recommendation_viewed — recommendations panel renders with real data.
 *                          The value moment.
 *   share_clicked         — user copies a share URL.
 *                          "Worth passing on."
 */

export type UmamiEvent =
  | 'roster_built'
  | 'recommendation_viewed'
  | 'share_clicked';

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, unknown>) => void;
    };
  }
}

export function trackEvent(
  event: UmamiEvent,
  data?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  window.umami?.track(event, data);
}
