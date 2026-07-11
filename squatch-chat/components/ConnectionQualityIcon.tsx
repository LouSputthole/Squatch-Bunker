"use client";

type Quality = "good" | "fair" | "poor" | "unknown";

interface ConnectionQualityIconProps {
  quality: Quality;
  pingMs?: number;
}

export default function ConnectionQualityIcon({ quality, pingMs }: ConnectionQualityIconProps) {
  const good = "#22c55e";
  const fair = "#eab308";
  const poor = "#ef4444";
  const unknown = "#6b7280";

  let bar1Color: string;
  let bar2Color: string;
  let bar3Color: string;

  switch (quality) {
    case "good":
      bar1Color = good;
      bar2Color = good;
      bar3Color = good;
      break;
    case "fair":
      bar1Color = fair;
      bar2Color = fair;
      bar3Color = unknown;
      break;
    case "poor":
      bar1Color = poor;
      bar2Color = unknown;
      bar3Color = unknown;
      break;
    default:
      bar1Color = unknown;
      bar2Color = unknown;
      bar3Color = unknown;
  }

  const label = pingMs != null ? `${pingMs}ms` : quality;

  return (
    <div className="relative group cursor-default" title={label}>
      <svg width="16" height="12" viewBox="0 0 16 12">
        <rect x="0" y="8" width="3" height="4" rx="1" fill={bar1Color} />
        <rect x="5" y="5" width="3" height="7" rx="1" fill={bar2Color} />
        <rect x="10" y="2" width="3" height="10" rx="1" fill={bar3Color} />
      </svg>
    </div>
  );
}

export type { Quality };
