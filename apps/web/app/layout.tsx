import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import { Fraunces, Libre_Franklin, JetBrains_Mono, Bungee } from 'next/font/google';
import './globals.css';
import { BHROverridesProvider } from '../lib/bhr-overrides-context';
import { RelicOverridesProvider } from '../lib/relic-overrides-context';
import { ThemeToggle } from '../components/theme-toggle';
import { BackToTop } from '../components/back-to-top';

// FOUC-prevention script: runs synchronously in <head> before paint so the
// warm-black bg is applied before the first frame renders. localStorage
// wins over prefers-color-scheme; empty storage falls back to the OS.
// Inline (not a module) is deliberate — a React effect would flash first.
const themeInit = `(function(){try{var t=localStorage.getItem('mcoc-theme');if(t==='dark'||t==='light')document.documentElement.dataset.mode=t;else if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.dataset.mode='dark';}catch(e){}})();`;

// Editorial almanack typography per architecture-v5 §10.
// Fraunces for display, Libre Franklin for body, JetBrains Mono for numerics,
// Bungee strictly for the burst moment on top recommendations.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  weight: ['400', '500', '600', '700'],
});
const libreFranklin = Libre_Franklin({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-libre-franklin',
  weight: ['400', '500', '600'],
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
  weight: ['400', '500'],
});
const bungee = Bungee({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bungee',
  weight: ['400'],
});

export const metadata: Metadata = {
  title: 'MCOC Prestige Tools',
  description:
    'Roster-aware prestige optimisation for Marvel Contest of Champions. Free, fast, no signup.',
};

// Without an explicit viewport meta, mobile browsers render the page at
// the default 980px CSS width and scale to fit, which breaks the
// responsive layout and lets users pinch-zoom into a broken view.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${libreFranklin.variable} ${jetbrainsMono.variable} ${bungee.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <BHROverridesProvider>
        <RelicOverridesProvider>
        <header className="border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)]">
          <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center gap-3 sm:gap-0 sm:justify-between">
            <Link
              href="/"
              className="editorial-heading text-xl text-[var(--color-marvel-editorial)] flex items-center gap-2"
            >
              <span>mcoc.help</span>
              <span
                className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-[var(--color-ink-soft)]/40 text-[var(--color-ink-soft)]"
                title="Still iterating. Data and features keep improving — report anything that looks wrong."
              >
                beta
              </span>
            </Link>
            <ul className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 text-sm font-medium sm:flex-nowrap sm:justify-end sm:gap-x-6">
              <li>
                <Link
                  href="/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  Recommendations
                </Link>
              </li>
              <li>
                <Link
                  href="/roster/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  Roster
                </Link>
              </li>
              <li>
                <Link
                  href="/relics/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  Relics
                </Link>
              </li>
              <li>
                <Link
                  href="/war/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  War
                </Link>
              </li>
              <li>
                <Link
                  href="/immunities/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  Immunities
                </Link>
              </li>
              <li>
                <Link
                  href="/champions/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  Champions
                </Link>
              </li>
              <li>
                <Link
                  href="/about/"
                  className="hover:text-[var(--color-marvel-impact)] transition-colors"
                >
                  About
                </Link>
              </li>
              <li className="ml-1 sm:ml-2">
                <ThemeToggle />
              </li>
            </ul>
          </nav>
        </header>

        <main className="flex-1 max-w-6xl mx-auto px-6 py-12 w-full">{children}</main>

        <footer className="border-t border-[var(--color-rule)] mt-12 py-8 text-sm text-[var(--color-ink-soft)]">
          <div className="max-w-6xl mx-auto px-6 flex flex-col gap-3">
            <div className="flex flex-wrap gap-4 justify-between">
              <div>
                Data from{' '}
                <a
                  href="https://mcochub.insaneskull.com"
                  className="underline hover:text-[var(--color-marvel-impact)]"
                  target="_blank"
                  rel="noopener"
                >
                  MCOCHUB
                </a>{' '}
                by InsaneSkull, cross-checked against{' '}
                <a
                  href="https://mcoc.gg"
                  className="underline hover:text-[var(--color-marvel-impact)]"
                  target="_blank"
                  rel="noopener"
                >
                  mcoc.gg
                </a>{' '}
                by BrutalDX.
              </div>
              <div>
                Free, no signup.{' '}
                <Link href="/about/" className="underline hover:text-[var(--color-marvel-impact)]">
                  Read the working →
                </Link>
              </div>
            </div>
            <div className="text-xs italic">
              Scope: 7-star champions, 6/7★ relics. Older star levels aren&apos;t planned
              — this tool exists for 7-star prestige planning going forward.
            </div>
          </div>
        </footer>
        </RelicOverridesProvider>
        </BHROverridesProvider>
        <BackToTop />
        {/* Umami: cookieless analytics. No PII; no consent banner needed.
            Self-traffic excluded via localStorage["umami.disabled"]="1". */}
        <Script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="a0f89c67-f296-4fb2-9920-7b8187d8a15f"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
