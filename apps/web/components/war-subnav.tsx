import Link from 'next/link';

/**
 * Shared sub-navigation across the three War pages. Rendered inside
 * each page's own layout so the active tab reads from the route rather
 * than any client state.
 *
 * Order matches the workflow: paste BG rosters once, then use whichever
 * tool the task calls for.
 */
type WarSubnavProps = {
  active: 'rosters' | 'diversity' | 'planner';
};

const TABS: Array<{
  id: 'rosters' | 'diversity' | 'planner';
  label: string;
  href: string;
  chip?: string;
}> = [
  { id: 'rosters', label: 'BG rosters', href: '/war-rosters/' },
  { id: 'diversity', label: 'Diversity', href: '/war/' },
  { id: 'planner', label: 'Planner', href: '/war-planner/', chip: 'alpha' },
];

export function WarSubnav({ active }: WarSubnavProps) {
  return (
    <nav
      aria-label="War tools"
      className="flex flex-wrap gap-1 border-b border-[var(--color-rule)]"
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm transition-colors -mb-px ${
              isActive
                ? 'text-[var(--color-ink)] font-medium border-b-2 border-[var(--color-marvel-editorial)]'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] border-b-2 border-transparent'
            }`}
          >
            {t.label}
            {t.chip && (
              <span
                className="text-[10px] font-mono uppercase tracking-widest px-1 py-0.5 rounded border border-[var(--color-marvel-editorial)]/70 text-[var(--color-marvel-editorial)]"
                aria-label={t.chip === 'alpha' ? 'Alpha release' : t.chip}
              >
                {t.chip}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
