import { loadActiveChampions } from '../../lib/data-loader';
import { RosterManager } from '../../components/roster-manager';

export default function RosterPage() {
  const champions = loadActiveChampions();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">Your roster</h1>
        <p className="text-[var(--color-ink-soft)]">
          Add champions one by one. Your roster stays in your browser — no
          signup, nothing leaves your device.
        </p>
      </section>

      <RosterManager champions={champions} />
    </div>
  );
}
