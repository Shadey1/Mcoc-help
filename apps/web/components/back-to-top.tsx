'use client';

import { useEffect, useState } from 'react';

/**
 * Persistent bottom-right "back to top" button.
 *
 * Uses the burst treatment (Bungee typeface, yellow starburst, red
 * text) — the same visual grammar as the top-recommendation delta on
 * the home page, kept intentional. Appears after the user scrolls
 * past ~400 px so it doesn't cover content on short pages.
 *
 * prefers-reduced-motion swaps the smooth-scroll for a jump so the
 * viewport doesn't sail past the top for users who dislike animation.
 */
const REVEAL_PX = 400;

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > REVEAL_PX);
    }
    // Prime state — if the page lands mid-scroll (e.g. anchor link) the
    // button should appear immediately, not wait for the first movement.
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function goTop() {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Back to top"
      className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 transition-all duration-200 ${
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none'
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-marvel-impact)]/60 rounded-full`}
    >
      {/* The .burst-badge shape gives us the yellow starburst + red
          Bungee text treatment for free (defined in globals.css). */}
      <span className="burst-badge text-[13px] tracking-wider">
        TOP&nbsp;↑
      </span>
    </button>
  );
}
