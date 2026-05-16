'use client';

import { useState } from 'react';
import type { ChampionClass } from '@prestige-tools/engine';

/**
 * Class icons — hot-linked from Fandom CDN, with inline SVG fallback.
 *
 * The Fandom URLs follow MediaWiki's hash-bucket layout
 * (/images/<hash[0]>/<hash[0:2]>/<filename>). MD5 hashes derived once,
 * baked in. Same fair-use rationale as champion portraits (architecture-v5
 * §17): free informational tool, transformative purpose, falls back gracefully.
 *
 * If Fandom changes filenames or URL structure, the image fails to load
 * and the inline SVG renders — site keeps working, just less authentic.
 */

const CLASS_ICON_URLS: Record<ChampionClass, string> = {
  Cosmic:  'https://static.wikia.nocookie.net/marvel-contestofchampions/images/1/1f/Cosmic.png',
  Mystic:  'https://static.wikia.nocookie.net/marvel-contestofchampions/images/5/5e/Mystic.png',
  Mutant:  'https://static.wikia.nocookie.net/marvel-contestofchampions/images/5/58/Mutant.png',
  Science: 'https://static.wikia.nocookie.net/marvel-contestofchampions/images/a/a5/Science.png',
  Skill:   'https://static.wikia.nocookie.net/marvel-contestofchampions/images/7/74/Skill.png',
  Tech:    'https://static.wikia.nocookie.net/marvel-contestofchampions/images/9/9c/Tech.png',
};

// Class colours for the SVG fallback and for tinted backgrounds elsewhere.
const CLASS_COLORS: Record<ChampionClass, { bg: string; fg: string }> = {
  Cosmic:  { bg: '#1E3A8A', fg: '#FCD34D' },
  Mystic:  { bg: '#581C87', fg: '#E9D5FF' },
  Mutant:  { bg: '#A16207', fg: '#FEF3C7' },
  Science: { bg: '#15803D', fg: '#A7F3D0' },
  Skill:   { bg: '#991B1B', fg: '#FECACA' },
  Tech:    { bg: '#1F2937', fg: '#93C5FD' },
};

export function classColors(klass: ChampionClass): { bg: string; fg: string } {
  return CLASS_COLORS[klass];
}

type ClassIconProps = {
  klass: ChampionClass;
  size?: number;
  className?: string;
};

export function ClassIcon({ klass, size = 32, className }: ClassIconProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = CLASS_ICON_URLS[klass];

  if (!imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`${klass} class`}
        width={size}
        height={size}
        onError={() => setImageFailed(true)}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={className}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }

  // SVG fallback — our own stylised geometry, never breaks
  const { bg, fg } = CLASS_COLORS[klass];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={`${klass} class`}
    >
      <circle cx="24" cy="24" r="22" fill={bg} />
      {renderClassGlyph(klass, fg)}
    </svg>
  );
}

function renderClassGlyph(klass: ChampionClass, fg: string) {
  switch (klass) {
    case 'Cosmic':
      return (
        <path
          d="M24 8 L26 22 L40 24 L26 26 L24 40 L22 26 L8 24 L22 22 Z"
          fill={fg}
        />
      );
    case 'Mystic':
      return (
        <g fill="none" stroke={fg} strokeWidth="3" strokeLinecap="round">
          <path d="M24 12 Q34 12 34 24 Q34 36 24 36 Q14 36 14 24" />
          <circle cx="24" cy="24" r="3" fill={fg} stroke="none" />
        </g>
      );
    case 'Mutant':
      return (
        <g fill="none" stroke={fg} strokeWidth="3" strokeLinecap="round">
          <path d="M12 14 L36 34" />
          <path d="M36 14 L12 34" />
        </g>
      );
    case 'Science':
      return (
        <g fill="none" stroke={fg} strokeWidth="2.5">
          <ellipse cx="24" cy="24" rx="16" ry="6" />
          <ellipse cx="24" cy="24" rx="16" ry="6" transform="rotate(60 24 24)" />
          <ellipse cx="24" cy="24" rx="16" ry="6" transform="rotate(120 24 24)" />
          <circle cx="24" cy="24" r="3.5" fill={fg} stroke="none" />
        </g>
      );
    case 'Skill':
      return (
        <g fill="none" stroke={fg} strokeWidth="2.5">
          <circle cx="24" cy="24" r="12" />
          <line x1="24" y1="6" x2="24" y2="14" />
          <line x1="24" y1="34" x2="24" y2="42" />
          <line x1="6" y1="24" x2="14" y2="24" />
          <line x1="34" y1="24" x2="42" y2="24" />
        </g>
      );
    case 'Tech':
      return (
        <g fill={fg}>
          <path d="M24 10 L28 12 L32 10 L34 14 L38 16 L38 20 L42 24 L38 28 L38 32 L34 34 L32 38 L28 36 L24 38 L20 36 L16 38 L14 34 L10 32 L10 28 L6 24 L10 20 L10 16 L14 14 L16 10 L20 12 Z" />
          <circle cx="24" cy="24" r="5" fill={CLASS_COLORS.Tech.bg} />
        </g>
      );
  }
}
