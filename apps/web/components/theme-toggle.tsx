'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'mcoc-theme';

type Resolved = 'light' | 'dark';

function resolveCurrent(): Resolved {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset.mode;
  if (attr === 'light' || attr === 'dark') return attr;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return 'light';
}

/**
 * Header-mounted mode switcher. Two-state light/dark; the initial value
 * is derived from the FOUC-prevention script that ran in <head> (which
 * reads localStorage first, then the OS preference). Clicking flips
 * <html data-mode> and writes localStorage — no page reload.
 *
 * Icons swap: sun in dark mode (click to go light), moon in light mode
 * (click to go dark). Both are inline SVG so there's no icon-font cost
 * or CDN dependency.
 */
export function ThemeToggle() {
  // We can't read the resolved mode during SSR — the token doesn't exist
  // yet — so we start neutral and let the mount effect sync. This means
  // the button icon renders as "moon" server-side then may flip on
  // hydrate; since it's a single icon in a small button, the swap isn't
  // visually disruptive. The BODY colours are already correct because
  // the head script ran before paint.
  const [mode, setMode] = useState<Resolved>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMode(resolveCurrent());
    setReady(true);
  }, []);

  function flip() {
    const next: Resolved = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / quota — the flip still takes effect for this session.
    }
    setMode(next);
  }

  const isDark = mode === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      title={label}
      // suppressHydrationWarning: SSR renders one icon, client may render
      // the other after resolveCurrent(). No visual jump matters since
      // both icons are the same size.
      suppressHydrationWarning
      className="inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] hover:border-[var(--color-marvel-impact)]/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-marvel-impact)]/60"
    >
      {ready && isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}
