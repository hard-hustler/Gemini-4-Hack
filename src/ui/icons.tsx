// One small stroke icon set, so the UI never leans on text glyphs.
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  arrowRight: <path d="M3 8h10M9 4l4 4-4 4" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  mic: (
    <>
      <rect x="6" y="2" width="4" height="7.5" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2" />
    </>
  ),
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1" />,
  clip: <path d="M11.5 7.5l-4.2 4.2a2.5 2.5 0 01-3.5-3.5l5-5a1.7 1.7 0 012.4 2.4l-4.9 4.9a.8.8 0 01-1.2-1.2L9.5 5" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />,
  external: <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />,
  rotate: <path d="M12.5 8a4.5 4.5 0 11-1.6-3.4M12.5 3v2.5H10" />,
  list: <path d="M5.5 4h7.5M5.5 8h7.5M5.5 12h7.5M2.8 4h.1M2.8 8h.1M2.8 12h.1" />,
  warn: <path d="M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.2v.1" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
