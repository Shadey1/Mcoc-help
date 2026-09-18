import { loadActiveChampions } from '../lib/data-loader';
import { RecommendationsView } from '../components/recommendations-view';

export default function RecommendationsPage() {
  const champions = loadActiveChampions();

  return (
    <div className="space-y-12">
      <section>
        <h1 className="editorial-heading text-4xl mb-2">
          What should I do with my roster?
        </h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-2xl">
          Add your roster, get told what to do next. What&apos;s worth
          ranking, what&apos;s worth pulling — sorted by how much prestige
          it actually adds.
        </p>
      </section>

      <RecommendationsView champions={champions} />
    </div>
  );
}
