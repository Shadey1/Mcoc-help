import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Fraunces, Libre_Franklin, JetBrains_Mono, Bungee } from 'next/font/google';
import './globals.css';
import { BHROverridesProvider } from '../lib/bhr-overrides-context';

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
    >
      <body className="min-h-screen flex flex-col">
        <BHROverridesProvider>
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
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-medium sm:flex-nowrap sm:justify-end sm:gap-x-6">
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
        </BHROverridesProvider>
      </body>
    </html>
  );
}
