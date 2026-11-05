import type { ReactNode } from "react";
import type { Technique } from "@brusshy/core";

/** Icons for the exploration tools (16px grid, stroke = currentColor). */

const svg = (children: ReactNode, fill = false) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const XIcons = {
  radial: svg(
    <>
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse key={a} cx="8" cy="4.2" rx="1.5" ry="2.9" transform={`rotate(${a} 8 8)`} fill="currentColor" stroke="none" opacity={a ? 0.55 : 1} />
      ))}
    </>,
  ),
  mirror: svg(
    <>
      <path d="M8 1.5v13" strokeDasharray="1.5 1.6" strokeWidth="1.1" />
      <path d="M6.6 3.5C3.6 4.6 2.2 8 3.2 11.6c.6 1.4 2.2 1.5 3.4.9z" fill="currentColor" stroke="none" />
      <path d="M9.4 3.5c3 1.1 4.4 4.5 3.4 8.1-.6 1.4-2.2 1.5-3.4.9z" fill="currentColor" stroke="none" opacity=".45" />
    </>,
  ),
  grid: svg(
    <>
      {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={2 + c * 4.4} y={2 + r * 4.4} width="3.2" height="3.2" rx=".8" fill="currentColor" stroke="none" opacity={r || c ? 0.5 : 1} />))}
    </>,
  ),
  repeat: svg(
    <>
      <circle cx="8" cy="8" r="5.6" strokeDasharray="2 1.6" strokeWidth="1.2" />
      <circle cx="8" cy="2.4" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12.85" cy="10.8" r="1.7" fill="currentColor" stroke="none" opacity=".55" />
      <circle cx="3.15" cy="10.8" r="1.7" fill="currentColor" stroke="none" opacity=".55" />
    </>,
  ),
  refresh: svg(
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.6v2.6h-2.6" />
    </>,
  ),
  explore: svg(
    <>
      <rect x="1.8" y="1.8" width="5.4" height="5.4" rx="1.2" />
      <circle cx="11.6" cy="4.5" r="2.7" />
      <path d="M4.5 9.2l2.8 4.8H1.7z" />
      <path d="M9.2 9.4h4.8v4.8H9.2z" fill="currentColor" stroke="none" opacity=".5" />
    </>,
  ),
  board: svg(
    <>
      <rect x="1.6" y="2.4" width="6" height="5" rx="1" />
      <rect x="9" y="2.4" width="5.4" height="7.4" rx="1" />
      <rect x="1.6" y="9" width="6" height="4.6" rx="1" />
      <path d="M9 12.2h5.4" />
    </>,
  ),
  plus: svg(<path d="M8 3v10M3 8h10" />),
  close: svg(<path d="M4 4l8 8M12 4l-8 8" />),
  search: svg(
    <>
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.4 10.4L14 14" />
    </>,
  ),
  external: svg(
    <>
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5L7.5 8.5" />
      <path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </>,
  ),
  image: svg(
    <>
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6" />
      <circle cx="5.6" cy="6.2" r="1.3" />
      <path d="M2.4 12.2l3.8-3.6 2.6 2.4 2.2-1.8 3 2.6" />
    </>,
  ),
  check: svg(<path d="M3.2 8.4l3 3 6.6-6.8" />),
};

/** A technique's tiny diagram (our own drawing, 48×48), themed by CSS (.xpl-diagram). */
export function TechniqueDiagram({ t, size = 64 }: { t: Technique; size?: number }) {
  return <svg className="xpl-diagram" viewBox="0 0 48 48" width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: t.diagram }} />;
}
