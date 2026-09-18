import { WarSubnav } from '../../components/war-subnav';
import { WarRostersTab } from '../../components/war-rosters-tab';

export const metadata = {
  title: 'War · BG rosters — mcoc.help',
  description:
    'Paste your three battlegroups\' roster shares once — both the Diversity tool and the Season planner read from here.',
};

export default function WarRostersPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-4xl mb-1">War</h1>
        <p className="text-[var(--color-ink-soft)]">
          Set up your BG rosters here.
        </p>
      </section>
      <WarSubnav active="rosters" />
      <WarRostersTab />
    </div>
  );
}
