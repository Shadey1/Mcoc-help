import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="space-y-10 max-w-3xl">
      <section>
        <h1 className="editorial-heading text-3xl mb-3">About this tool</h1>
        <p className="text-[var(--color-ink-soft)]">
          A free roster-aware prestige optimiser for Marvel Contest of
          Champions. Built because every other tool either calculates without
          recommending, paywalls the calculator, or has gone dark.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">The math</h2>
        <p>
          <strong>Champion prestige</strong> is the floor of the average of
          your top-30 champions&apos; <strong>Base Hero Rating (BHR)</strong>.
          BHR is what the in-game prestige page shows — distinct from PI,
          which mixes in synergies, masteries, and relics.
        </p>
        <p>
          BHR is calculated as:
        </p>
        <pre className="bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-4 text-sm overflow-x-auto numeric">
          BHR = sig0 + (sig200 − sig0) × sigCurve(rank, sig)
          {'\n'}        × ascensionMultiplier
        </pre>
        <p>The constants (locked empirically against Dave&apos;s verified roster):</p>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>
            <strong>Rank multipliers:</strong> R5 = 1.000, R4 = 0.8431, R3 = 0.6906
          </li>
          <li>
            <strong>Ascension multipliers:</strong> A0 = 1.00, A1 = 1.08, A2 = 1.16
          </li>
          <li>
            <strong>Sig curves:</strong> rank-dependent. Sig 0 → 100 captures
            more BHR than sig 100 → 200 at every rank. The curve is concave.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Two views, one engine</h2>
        <p>
          <strong>Atomic moves</strong> answers &ldquo;what should I do
          next?&rdquo; — ranked by prestige delta, with cost gates labelled so
          you can match against what you actually have.
        </p>
        <p>
          <strong>Ceiling view</strong> answers &ldquo;what&apos;s worth
          investing in long-term?&rdquo; — for every champion in your roster,
          computes the prestige impact of fully developing them.
        </p>
        <p>
          They use the same data and primitives but give you different cuts.
          Look at atomic moves when you have catalysts burning a hole in your
          inventory; look at ceiling when you&apos;re planning your next 6
          months.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Data sources</h2>
        <p>
          Champion BHR reference values come from{' '}
          <a
            href="https://mcochub.insaneskull.com"
            className="underline hover:text-[var(--color-marvel-impact)]"
            target="_blank"
            rel="noopener"
          >
            MCOCHUB
          </a>
          , maintained by InsaneSkull as a community project. Cross-validated
          against{' '}
          <a
            href="https://mcoc.gg"
            className="underline hover:text-[var(--color-marvel-impact)]"
            target="_blank"
            rel="noopener"
          >
            mcoc.gg
          </a>{' '}
          (BrutalDX), which launched a prestige table view in April 2026.
          Champion metadata (class, release dates, immunities) draws from the{' '}
          <a
            href="https://marvel-contestofchampions.fandom.com"
            className="underline hover:text-[var(--color-marvel-impact)]"
            target="_blank"
            rel="noopener"
          >
            Fandom wiki
          </a>{' '}
          under CC-BY-SA.
        </p>
        <p>
          This tool exists because of years of volunteer data work by the MCOC
          community. If you spot an error in our numbers, the correction belongs
          upstream too — we&apos;ll feed it back.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">What this tool doesn&apos;t do</h2>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>
            <strong>Track your stash.</strong> Cost gates are labelled, not
            tracked. You know what you have; we don&apos;t need to.
          </li>
          <li>
            <strong>Plan multi-step sequences.</strong> v1 surfaces atomic
            moves and ceilings; multi-step planning lives in v2.
          </li>
          <li>
            <strong>Optimise relic prestige.</strong> Relic is its own loop and
            will live in v2.
          </li>
          <li>
            <strong>Tell you who to play.</strong> No tier lists, no rotation
            guides, no defender meta. Tools for that exist; this is about prestige.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Free, no signup</h2>
        <p>
          Hosted on Cloudflare Pages. Tip jar pending. No ads, no paywall, no
          tracking beyond Cloudflare Web Analytics (cookieless).
        </p>
        <p>
          <Link href="/" className="underline hover:text-[var(--color-marvel-impact)]">
            ← Back to the recommendations view
          </Link>
        </p>
      </section>
    </div>
  );
}
