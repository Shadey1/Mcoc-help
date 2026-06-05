'use client';

import { useState, type ReactNode } from 'react';

/**
 * Lightweight collapsible section. Default-closed so a page with many
 * sections stays compact on first load; user expands what they need.
 *
 * Click anywhere on the header bar to toggle. The header shows a short
 * count/summary on the right so users can scan progress without opening.
 */
export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  /** Optional small label on the right (e.g. count, status). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border border-[var(--color-rule)] rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-paper-soft)] transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="editorial-heading text-2xl">{title}</span>
          {summary && (
            <span className="text-xs text-[var(--color-ink-soft)]">
              {summary}
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--color-ink-soft)] font-mono whitespace-nowrap">
          {open ? '▼ hide' : '▶ show'}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-[var(--color-rule)]/40">
          {children}
        </div>
      )}
    </section>
  );
}
