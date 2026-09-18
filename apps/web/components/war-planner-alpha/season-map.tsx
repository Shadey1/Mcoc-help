'use client';

import { useMemo } from 'react';
import {
  SEASON_NODES,
  SEASON_EDGES,
  SEASON_LANE,
  SEASON_PT,
  seasonLane,
  seasonPos,
  type NodeNumber,
  type NodePlacement,
  type SeasonPlan,
} from '@prestige-tools/engine';
import { picksAt } from './plan-model';

/**
 * War map SVG. Ported from the mockup's `drawMap` with these changes:
 *   - React JSX instead of template-string HTML
 *   - Colours read from LANE (engine module) so they stay stable in
 *     light/dark; other chrome uses semantic tokens
 *   - Rings are keyed by outcome class ('first' | 'pick' | 'auto' | 'miss')
 *
 * Placements come from the last solve; when null, the map shows an empty
 * grid with pick-count badges. Ownership names come from the player-name
 * map so the map can label who's placing what.
 */

type SeasonMapProps = {
  plan: SeasonPlan;
  placements: Record<NodeNumber, NodePlacement> | null;
  moved: ReadonlySet<NodeNumber>;
  selectedNode: NodeNumber | null;
  onSelectNode: (node: NodeNumber) => void;
  championNameFor: (championId: string) => string;
  championShortFor: (championId: string) => string;
  playerNameFor: (playerId: string) => string;
};

/** Which outcome bucket a placement falls into — controls the ring style. */
function outcomeOf(pl: NodePlacement | undefined): 'first' | 'pick' | 'auto' | 'miss' {
  if (!pl) return 'miss';
  if (pl.pickRank === 0) return 'first';
  if (pl.pickRank > 0) return 'pick';
  return 'auto';
}

/** Where a node's label sits: below the portrait, or to a side (boss row). */
function labelSide(n: NodeNumber): 'B' | 'L' | 'R' {
  if (n === 46 || n === 48) return 'L';
  if (n === 47 || n === 49 || n === 50) return 'R';
  return 'B';
}

function isPT(x: number | string): x is keyof typeof SEASON_PT {
  return typeof x === 'string' && x in SEASON_PT;
}
function coord(x: number | string): readonly [number, number] {
  if (typeof x === 'number') return seasonPos(x as NodeNumber);
  if (isPT(x)) return SEASON_PT[x]!;
  throw new Error(`unknown endpoint: ${String(x)}`);
}

export function SeasonMap({
  plan,
  placements,
  moved,
  selectedNode,
  onSelectNode,
  championNameFor,
  championShortFor,
  playerNameFor,
}: SeasonMapProps) {
  const reveal = useMemo(
    () => (placements !== null ? sortForReveal(placements) : []),
    [placements],
  );

  return (
    <div className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-2 sm:p-3">
      <svg
        viewBox="60 18 960 1220"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Alliance war map, 50 nodes"
        className="block w-full h-auto max-h-[calc(100vh-180px)]"
      >
        {/* Edges */}
        {SEASON_EDGES.map((e, i) => {
          const [x1, y1] = coord(e[0]);
          const [x2, y2] = coord(e[1]);
          const style = e[2];
          if (style === 'hub') {
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--color-marvel-editorial)"
                strokeOpacity={0.6}
                strokeWidth={3}
                strokeDasharray="12 8"
              />
            );
          }
          if (style === 'dot') {
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={e[3] ?? 'currentColor'}
                strokeOpacity={0.7}
                strokeWidth={2.5}
                strokeDasharray="3 6"
              />
            );
          }
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--color-rule)"
              strokeWidth={3}
            />
          );
        })}
        {/* Junction dots */}
        {Object.keys(SEASON_PT).map((k) => {
          const [x, y] = SEASON_PT[k]!;
          return (
            <g key={k}>
              <circle cx={x} cy={y} r={k === 'h1' || k === 'h2' ? 9 : 6.5} fill="#b8913f" />
              {k.length === 1 && (
                <text
                  x={x - 14}
                  y={y + 5}
                  textAnchor="end"
                  fontSize={16}
                  fontWeight={700}
                  fill="var(--color-marvel-editorial)"
                >
                  {k}
                </text>
              )}
            </g>
          );
        })}
        {/* Nodes */}
        {SEASON_NODES.map((n) => {
          const [x, y] = seasonPos(n);
          const pl = placements?.[n];
          const picks = picksAt(plan, n);
          const kind = placements ? outcomeOf(pl) : null;
          const isMoved = moved.has(n);
          const isSelected = selectedNode === n;
          const isKey = plan.keyNodes.has(n);
          const isPinned = plan.pins[n];
          const laneColor = SEASON_LANE[seasonLane(n)]!;
          const side = labelSide(n);
          const tight = n >= 37 && n <= 45;
          const revealIdx = pl ? reveal.indexOf(n) : -1;
          return (
            <g
              key={n}
              onClick={() => onSelectNode(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectNode(n);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Node ${n}${pl ? `, ${championNameFor(pl.championId)} from ${playerNameFor(pl.playerId)}` : ''}`}
              className="cursor-pointer focus:outline-none"
            >
              {isMoved && (
                <rect
                  x={x - 39}
                  y={y - 33}
                  width={78}
                  height={66}
                  rx={15}
                  fill="#d9a93f"
                  fillOpacity={0.22}
                  stroke="#d9a93f"
                  strokeWidth={2}
                />
              )}
              {kind && renderRing(x, y, kind)}
              <rect
                x={x - 29}
                y={y - 23}
                width={58}
                height={46}
                rx={9}
                fill={laneColor}
                stroke={isSelected ? '#d9a93f' : 'rgba(255,255,255,0.18)'}
                strokeWidth={isSelected ? 3 : 1}
              />
              <text
                x={x}
                y={y + 7.5}
                textAnchor="middle"
                fontSize={21}
                fontWeight={700}
                fill="#fff"
                pointerEvents="none"
              >
                {n}
              </text>
              {isKey && (
                <path
                  d={`M${x - 29} ${y - 12} L${x - 29} ${y - 23} L${x - 18} ${y - 23} Z`}
                  fill="var(--color-marvel-impact)"
                />
              )}
              {!placements && picks.length > 0 && (
                <>
                  <circle
                    cx={x + 27}
                    cy={y - 21}
                    r={10}
                    fill="var(--color-paper)"
                    stroke="var(--color-ink)"
                    strokeWidth={1.5}
                  />
                  <text
                    x={x + 27}
                    y={y - 16.5}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill="var(--color-ink)"
                  >
                    {picks.length}
                  </text>
                </>
              )}
              {isPinned && (
                <g transform={`translate(${x + 19},${y - 33})`}>
                  <rect x={0} y={6} width={14} height={11} rx={2} fill="#d9a93f" />
                  <path
                    d="M3 7 V4 a4 4 0 0 1 8 0 V7"
                    fill="none"
                    stroke="#d9a93f"
                    strokeWidth={2}
                  />
                </g>
              )}
              {pl && (
                <g
                  style={
                    revealIdx >= 0
                      ? { animation: `war-rise 0.5s both`, animationDelay: `${revealIdx * 14}ms` }
                      : undefined
                  }
                >
                  {side === 'B' ? (
                    <>
                      <text
                        x={x}
                        y={y + 44}
                        textAnchor="middle"
                        fontSize={tight ? 12 : 14}
                        fontWeight={600}
                        fill="var(--color-ink)"
                        pointerEvents="none"
                      >
                        {truncate(championShortFor(pl.championId), tight ? 8 : 14)}
                      </text>
                      <text
                        x={x}
                        y={y + 58}
                        textAnchor="middle"
                        fontSize={11.5}
                        fill="var(--color-ink-soft)"
                        pointerEvents="none"
                      >
                        {truncate(playerNameFor(pl.playerId), 12)}
                      </text>
                    </>
                  ) : (
                    <>
                      <text
                        x={side === 'L' ? x - 42 : x + 42}
                        y={y}
                        textAnchor={side === 'L' ? 'end' : 'start'}
                        fontSize={14}
                        fontWeight={600}
                        fill="var(--color-ink)"
                        pointerEvents="none"
                      >
                        {truncate(championShortFor(pl.championId), 14)}
                      </text>
                      <text
                        x={side === 'L' ? x - 42 : x + 42}
                        y={y + 15}
                        textAnchor={side === 'L' ? 'end' : 'start'}
                        fontSize={11.5}
                        fill="var(--color-ink-soft)"
                        pointerEvents="none"
                      >
                        {truncate(playerNameFor(pl.playerId), 12)}
                      </text>
                    </>
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <style>{`
        @keyframes war-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) { g[style*="war-rise"] { animation: none !important } }
      `}</style>
    </div>
  );
}

function renderRing(x: number, y: number, kind: 'first' | 'pick' | 'auto' | 'miss') {
  const commonProps = {
    x: x - 34,
    y: y - 28,
    width: 68,
    height: 56,
    rx: 12,
    fill: 'none' as const,
  };
  if (kind === 'first') {
    return <rect {...commonProps} stroke="var(--color-ink)" strokeWidth={3} />;
  }
  if (kind === 'pick') {
    return <rect {...commonProps} stroke="var(--color-ink)" strokeOpacity={0.5} strokeWidth={1.5} />;
  }
  if (kind === 'auto') {
    return (
      <rect
        {...commonProps}
        stroke="var(--color-ink-soft)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
    );
  }
  return (
    <rect
      {...commonProps}
      stroke="var(--color-marvel-impact)"
      strokeWidth={2}
      strokeDasharray="5 4"
    />
  );
}

/** Reveal order: top rows first so the animation reads top-to-bottom. */
function sortForReveal(placements: Record<NodeNumber, NodePlacement>): NodeNumber[] {
  return Object.keys(placements)
    .map(Number)
    .sort((a, b) => seasonPos(a)[1] - seasonPos(b)[1]);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '…';
}
