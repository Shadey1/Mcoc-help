import { MySharesList } from '../../components/my-shares-list';

/**
 * "My Shares" management page.
 *
 * Lists every share the user has created on this device (kept in
 * localStorage under prestige-tools:my-shares), with per-row actions:
 *   - copy the view URL to send to alliance / recipients
 *   - copy the private sync URL (for live shares only)
 *   - convert a snapshot into a live share (PUT with mode=live)
 *   - delete the share entirely
 *
 * Server-side stays empty; the whole surface lives on the client
 * because localStorage isn't readable at build time.
 */
export default function MySharesPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">Your shares</h1>
        <p className="text-[var(--color-ink-soft)]">
          Every roster share you&apos;ve created from this browser. Live
          shares stay in sync with your latest edits; snapshots stay
          frozen. Delete tokens are held here in local storage so nothing
          leaves the device unless you copy a URL.
        </p>
      </section>
      <MySharesList />
    </div>
  );
}
