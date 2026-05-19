import Link from 'next/link';

export const metadata = {
  title: 'About — mcoc.help',
  description:
    'About mcoc.help — a free, roster-aware prestige optimisation tool for Marvel Contest of Champions.',
};

export default function AboutPage() {
  return (
    <div className="space-y-10 max-w-3xl">
      <section>
        <h1 className="editorial-heading text-3xl mb-3">About mcoc.help</h1>
        <p className="text-[var(--color-ink-soft)]">
          A free, roster-aware prestige optimiser for Marvel Contest of
          Champions. No signup, no ads, no paywall. Built and maintained by{' '}
          <strong>mu3rto</strong>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">What this is for</h2>
        <p>
          Every other tool in the prestige space either calculates without
          recommending, paywalls the calculator, or has been dark since 2024.
          Kabam&apos;s official calculator hasn&apos;t been updated since the
          Ascension+ launch. The result: most players don&apos;t know what they
          should rank up next, or which pull would actually move their
          prestige needle.
        </p>
        <p>
          mcoc.help fills the gap. Add your roster once; the tool ranks every
          available move by prestige impact, surfaces what&apos;s worth
          developing long-term, and tells you which unowned champions would be
          highest-impact pulls. The optimisation logic is the value-add — the
          underlying data comes from the community.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">How prestige works</h2>
        <p>
          Champion prestige is the floor of the average of your top-30
          champions&apos; <strong>Base Hero Rating (BHR)</strong>. BHR is what
          the in-game prestige page shows — distinct from PI, which mixes in
          synergies, masteries, and relics. The relic side of total prestige is
          a separate problem and lives in v2.
        </p>
        <p>BHR is computed as:</p>
        <pre className="bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-4 text-sm overflow-x-auto numeric">
          BHR = sig0 + (sig200 − sig0) × sigCurve(rank, sig)
          {'\n'}        × ascensionMultiplier
        </pre>
        <p>
          The constants are not in Kabam&apos;s public docs. They&apos;re
          derived empirically against verified rosters:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>
            <strong>Rank multipliers:</strong> R5 = 1.000, R4 = 0.8431, R3 = 0.6906
          </li>
          <li>
            <strong>Ascension multipliers:</strong> A0 = 1.00, A1 = 1.08, A2 = 1.16
          </li>
          <li>
            <strong>Sig curves:</strong> rank-dependent, concave. Sig 0 → 100
            captures roughly 65% of the gain available from sig 0 → 200.
          </li>
        </ul>
        <p className="text-sm text-[var(--color-ink-soft)]">
          These reproduce in-game prestige numbers to within ±30 BHR per
          champion and ±5 BHR on aggregate top-30 prestige, across a
          232-champion roster verification set.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">
          Short-term plan vs Long-term plan
        </h2>
        <p>Two views, same engine, different decisions.</p>
        <p>
          <strong>Short-term plan</strong> answers &ldquo;what should I do
          next?&rdquo; — every available atomic move (rank up, sig up, ascend),
          ranked by the prestige delta to your top-30. Cost gates labelled so
          you can match against what you actually have. Click <strong>I&apos;ve done
          this</strong> on any move to mark it complete and watch the list refresh.
        </p>
        <p>
          <strong>Long-term plan</strong> answers &ldquo;what&apos;s worth
          investing in?&rdquo; — split into two sections:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>
            <strong>In your roster — worth developing:</strong> owned champions
            ranked by the prestige they&apos;d add if taken to their full
            ceiling (R5 sig 200, max ascension where applicable).
          </li>
          <li>
            <strong>Worth pulling:</strong> unowned champions whose ceilings
            would displace your current rank-30 if you acquired and developed
            them. A pull-priority shortlist for featured, Titan, and sale
            crystals. Click <strong>I have this</strong> on any of them to
            quick-add to your roster.
          </li>
        </ul>
        <p>
          Look at short-term when you have catalysts burning a hole in your
          inventory. Look at long-term when you&apos;re planning your next six
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
            Marvel Contest of Champions Fandom wiki
          </a>{' '}
          under CC-BY-SA. Champion portrait images are hot-linked from the
          Fandom CDN.
        </p>
        <p>
          This tool exists because of years of volunteer data work by the MCOC
          community. If you spot an error in our numbers, the correction
          belongs upstream too — we&apos;ll feed it back.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">What this tool doesn&apos;t do</h2>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>
            <strong>Track your stash.</strong> Cost gates are labelled, not
            inventoried. You know what you have; we don&apos;t need to.
          </li>
          <li>
            <strong>Plan multi-step sequences.</strong> v1 surfaces atomic
            moves and ceilings; multi-step planning is a v2 task.
          </li>
          <li>
            <strong>Optimise relic prestige.</strong> Relics are the other ~6%
            of total prestige and need their own optimisation loop. Coming in
            v2.
          </li>
          <li>
            <strong>OCR your roster.</strong> Currently you type your champions
            in (or bulk-paste them). Screenshot-import from the in-game
            prestige page is a v2 priority.
          </li>
          <li>
            <strong>Track 5-star or 6-star champions.</strong> 7-star data
            only. The 7-star pool is what determines top prestige for Paragon
            and above.
          </li>
          <li>
            <strong>Tell you who to play.</strong> No tier lists, no rotation
            guides, no defender meta. Tools for that exist; this is about
            prestige.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Privacy</h2>
        <p>
          Your roster lives only in your browser&apos;s localStorage. Nothing
          is sent to a server, nothing is associated with an identity, nothing
          persists if you clear your browser data. There is no signup and no
          account.
        </p>
        <p>
          The one exception is the <strong>share roster</strong> feature, which
          uploads a copy of your roster to a 6-month-TTL key/value store so the
          shared link works for the recipient. The share is identified by an
          opaque 8-character ID and is never linked to your IP or identity
          beyond rate-limiting. Anyone with the link can view the roster. You
          can delete a share at any time using the delete token shown when
          the share is created.
        </p>
        <p>
          Site analytics are Cloudflare Web Analytics — cookieless, no
          third-party tracking, no fingerprinting.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Built by mu3rto</h2>
        <p>
          I built this because I wanted a better answer to &ldquo;what should I
          do with my roster?&rdquo; than the tools could give me, and because
          the tools that existed either cost money or had quietly stopped being
          maintained.
        </p>
        <p>
          If you find a bug or want to suggest a feature, the most reliable way
          to reach me is to{' '}
          <a
            href="https://github.com/Shadey1/Mcoc-help/issues"
            className="underline hover:text-[var(--color-marvel-impact)]"
            target="_blank"
            rel="noopener"
          >
            open an issue on GitHub
          </a>
          . If you&apos;d rather DM, find me on LINE: <strong>shadey6</strong>.
        </p>
        <p className="text-sm text-[var(--color-ink-soft)]">
          The code is open source on{' '}
          <a
            href="https://github.com/Shadey1/Mcoc-help"
            className="underline hover:text-[var(--color-marvel-impact)]"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>{' '}
          under the MIT license.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Tip jar</h2>
        <p>
          mcoc.help is and will stay free. If it&apos;s saved you time and you
          want to chip in,{' '}
          <a
            href="https://ko-fi.com/mu3rto"
            className="underline hover:text-[var(--color-marvel-impact)] font-medium"
            target="_blank"
            rel="noopener"
          >
            ko-fi.com/mu3rto
          </a>
          . Anything you put in goes toward hosting costs (currently about $22
          a year for the domain, $0 for everything else) and a beer when
          I&apos;m next debugging at midnight.
        </p>
      </section>

      <section className="pt-6 border-t border-[var(--color-rule)]">
        <Link href="/" className="underline hover:text-[var(--color-marvel-impact)]">
          ← Back to the recommendations view
        </Link>
      </section>
    </div>
  );
}
