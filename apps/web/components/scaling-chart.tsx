import multipliers from '../../../packages/engine/src/multipliers.json' with { type: 'json' };

/**
 * SVG line chart showing how a champion's BHR scales with sig at each rank,
 * for a chosen ascension level. Per-rank curves come from the normalised
 * sig curves in multipliers.json (rank3_default / rank4_default / rank5_default).
 *
 * Server-rendered SVG — no client JS needed. Tooltips on points are
 * progressive enhancement only.
 *
 * Note on imports: this file is in apps/web/components/, so the relative path
 * to packages/engine/src/multipliers.json goes up four levels.
 */

type ScalingChartProps = {
  rank5Sig0: number;
  rank5Sig200: number;
  ascendable: boolean;
};

const SIG_ANCHORS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200];
const RANK_MULT: Record<3 | 4 | 5, number> = {
  5: multipliers.ranks['5']!,
  4: multipliers.ranks['4']!,
  3: multipliers.ranks['3']!,
};

/**
 * Compute the BHR at every 20-sig increment for a given rank and ascension.
 * Mirrors the engine's bhr.ts logic but inline here to keep the chart a
 * pure server component (no engine import gymnastics).
 */
function curveBHRs(
  rank5Sig0: number,
  rank5Sig200: number,
  rank: 3 | 4 | 5,
  ascMult: number,
): number[] {
  const rankMult = RANK_MULT[rank];
  const sig0 = rank5Sig0 * rankMult;
  const sig200 = rank5Sig200 * rankMult;
  const curveKey = `rank${rank}_default` as keyof typeof multipliers.sigCurves;
  const curve = multipliers.sigCurves[curveKey] as readonly number[];
  return SIG_ANCHORS.map((_, i) => {
    const frac = curve[i] ?? 1;
    const raw = sig0 + (sig200 - sig0) * frac;
    return Math.round((raw * ascMult) / 10) * 10;
  });
}

export function ScalingChart({ rank5Sig0, rank5Sig200, ascendable }: ScalingChartProps) {
  const ascMult = ascendable ? 1.16 : 1.0;
  const r5 = curveBHRs(rank5Sig0, rank5Sig200, 5, ascMult);
  const r4 = curveBHRs(rank5Sig0, rank5Sig200, 4, ascMult);
  const r3 = curveBHRs(rank5Sig0, rank5Sig200, 3, ascMult);

  // Chart dimensions and padding
  const W = 600;
  const H = 280;
  const padL = 60;
  const padR = 20;
  const padT = 20;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Find min/max for the Y scale across all three lines
  const allValues = [...r3, ...r4, ...r5];
  const minY = Math.floor(Math.min(...allValues) / 5000) * 5000;
  const maxY = Math.ceil(Math.max(...allValues) / 5000) * 5000;

  function xPos(sigIdx: number): number {
    return padL + (sigIdx / (SIG_ANCHORS.length - 1)) * chartW;
  }
  function yPos(bhr: number): number {
    return padT + chartH - ((bhr - minY) / (maxY - minY)) * chartH;
  }

  function linePath(values: number[]): string {
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(v).toFixed(1)}`)
      .join(' ');
  }

  // Y-axis grid lines and labels — round increments of 5000
  const yTicks: number[] = [];
  for (let v = minY; v <= maxY; v += 5000) yTicks.push(v);

  return (
    <div className="border border-[var(--color-rule)] rounded bg-[var(--color-paper-card)] p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto"
        role="img"
        aria-label="BHR scaling chart by rank and signature level"
      >
        {/* Y grid lines */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yPos(tick)}
              y2={yPos(tick)}
              stroke="var(--color-rule)"
              strokeDasharray="2 3"
            />
            <text
              x={padL - 8}
              y={yPos(tick) + 4}
              fontSize="11"
              textAnchor="end"
              fill="var(--color-ink-soft)"
              className="numeric"
            >
              {tick.toLocaleString()}
            </text>
          </g>
        ))}

        {/* X-axis labels (sig 0, 50, 100, 150, 200) */}
        {[0, 50, 100, 150, 200].map((sig) => {
          const idx = sig / 20;
          return (
            <g key={sig}>
              <line
                x1={xPos(idx)}
                x2={xPos(idx)}
                y1={padT + chartH}
                y2={padT + chartH + 4}
                stroke="var(--color-ink-soft)"
              />
              <text
                x={xPos(idx)}
                y={padT + chartH + 18}
                fontSize="11"
                textAnchor="middle"
                fill="var(--color-ink-soft)"
                className="numeric"
              >
                {sig}
              </text>
            </g>
          );
        })}

        {/* X-axis title */}
        <text
          x={padL + chartW / 2}
          y={H - 4}
          fontSize="11"
          textAnchor="middle"
          fill="var(--color-ink-soft)"
        >
          Signature level
        </text>

        {/* R3 line (most muted) */}
        <path d={linePath(r3)} fill="none" stroke="var(--color-ink-soft)" strokeWidth="1.5" opacity="0.5" />
        {/* R4 line (mid) */}
        <path d={linePath(r4)} fill="none" stroke="var(--color-ink-soft)" strokeWidth="2" />
        {/* R5 line (impact) */}
        <path d={linePath(r5)} fill="none" stroke="var(--color-marvel-impact)" strokeWidth="2.5" />

        {/* End-of-line labels for ranks */}
        <text x={xPos(10) + 2} y={yPos(r5[10]!) + 4} fontSize="11" fill="var(--color-marvel-impact)" fontWeight="500">R5</text>
        <text x={xPos(10) + 2} y={yPos(r4[10]!) + 4} fontSize="11" fill="var(--color-ink-soft)" fontWeight="500">R4</text>
        <text x={xPos(10) + 2} y={yPos(r3[10]!) + 4} fontSize="11" fill="var(--color-ink-soft)" opacity="0.7" fontWeight="500">R3</text>
      </svg>

      <p className="text-xs text-[var(--color-ink-soft)] mt-2">
        BHR at each signature level by rank
        {ascendable ? ', at maximum ascension (A2)' : ' (non-ascendable — A0 only)'}.
        The curve is concave — sig 0&nbsp;→&nbsp;100 captures roughly two-thirds of the
        gain from sig 0&nbsp;→&nbsp;200.
      </p>
    </div>
  );
}
