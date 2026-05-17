import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Fraunces, Libre_Franklin, JetBrains_Mono, Bungee } from 'next/font/google';
import './globals.css';

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
        <header className="border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)]">
          <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center gap-3 sm:gap-0 sm:justify-between">
            <Link
              href="/"
              className="editorial-heading text-xl text-[var(--color-marvel-editorial)]"
            >
              mcoc.help
            </Link>
            <ul className="flex gap-4 sm:gap-6 text-sm font-medium whitespace-nowrap overflow-x-auto max-w-full -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
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
          <div className="max-w-6xl mx-auto px-6 flex flex-wrap gap-4 justify-between">
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
        </footer>
      </body>
    </html>
  );
}
