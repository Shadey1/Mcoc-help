'use client';

import { useState } from 'react';
import type { ChampionClass } from '@prestige-tools/engine';
import { ClassIcon, classColors } from './class-icon';

type ChampionPortraitProps = {
  name: string;
  klass: ChampionClass;
  portraitUrl?: string | null;
  /** Fixed pixel size. Mutually exclusive with `fill`. */
  size?: number;
  /** If true, fills the parent container width (aspect-square). Use for grids
   * where cells size from the column width rather than from a fixed portrait. */
  fill?: boolean;
  /** Render the class icon as a small overlay even when the portrait loads */
  showClassOverlay?: boolean;
};

export function ChampionPortrait({
  name,
  klass,
  portraitUrl,
  size = 80,
  fill = false,
  showClassOverlay = false,
}: ChampionPortraitProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = portraitUrl && !imageFailed;
  const { bg } = classColors(klass);

  const containerClasses = fill
    ? 'relative w-full aspect-square rounded overflow-hidden'
    : 'relative rounded overflow-hidden';
  const containerStyle: React.CSSProperties = fill ? {} : { width: size, height: size };

  if (showImage) {
    return (
      <div className={containerClasses} style={containerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={portraitUrl}
          alt={`${name} portrait`}
          onError={() => setImageFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full"
          style={{ objectFit: 'cover' }}
        />
        {showClassOverlay && (
          <div className="absolute bottom-1 right-1 bg-[var(--color-paper)] rounded-full p-0.5 shadow-sm">
            <ClassIcon
              klass={klass}
              size={fill ? 20 : Math.max(14, Math.round(size * 0.18))}
            />
          </div>
        )}
      </div>
    );
  }

  // Fallback: class icon on soft class-tinted backdrop.
  const tintedBg = `${bg}1F`;
  const iconPx = fill ? 64 : Math.round(size * 0.75);
  return (
    <div
      className={`${containerClasses} flex items-center justify-center`}
      style={{ ...containerStyle, backgroundColor: tintedBg }}
    >
      <ClassIcon klass={klass} size={iconPx} />
    </div>
  );
}
