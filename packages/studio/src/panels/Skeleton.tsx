import type { CSSProperties } from "react";
import "../styles/skeleton.css";

/** Shimmering placeholder block (respects prefers-reduced-motion). */
export function Skel({ w, h, r, style, className = "" }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties; className?: string }) {
  return <span className={`skel ${className}`} aria-hidden style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** A list of rows shaped like font-family entries (big preview line + small meta line). */
export function SkelRows({ rows = 8, big = 26 }: { rows?: number; big?: number }) {
  return (
    <div className="skel-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel-row" style={{ animationDelay: `${i * 40}ms` }}>
          <Skel w={`${58 + ((i * 37) % 34)}%`} h={big} r={6} />
          <Skel w={`${30 + ((i * 23) % 22)}%`} h={9} r={4} />
        </div>
      ))}
    </div>
  );
}
