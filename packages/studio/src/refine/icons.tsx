import type { ReactNode } from "react";
import type { RefineAction } from "@brusshy/core";

/** Line icons for the refine actions (24×24, 1.5px — same hand as panels/icons.tsx). */
const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const RefineIcons: Record<RefineAction | "wand" | "ai", ReactNode> = {
  simplify: (
    <I>
      <path d="M3.5 16c2.6-7.5 6.4-7.5 8.5 0s5.9 7.5 8.5 0" />
      <rect x="2.2" y="14.7" width="2.6" height="2.6" rx=".5" fill="var(--paper-lift)" />
      <rect x="10.7" y="14.7" width="2.6" height="2.6" rx=".5" fill="var(--paper-lift)" />
      <rect x="19.2" y="14.7" width="2.6" height="2.6" rx=".5" fill="var(--paper-lift)" />
    </I>
  ),
  smooth: (
    <I>
      <path d="M3 10.5l2-2.5 2 3 2-3.2 2 2.7" opacity=".45" />
      <path d="M3 16.5c3.2-4.6 6.3-4.6 9 0s5.8 4.6 9 0" />
    </I>
  ),
  bolder: (
    <I>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" strokeDasharray="1.6 2" opacity=".6" />
      <rect x="4" y="4" width="16" height="16" rx="3" strokeWidth={2.4} />
    </I>
  ),
  thinner: (
    <I>
      <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="1.6 2" opacity=".6" />
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" strokeWidth={1.2} />
    </I>
  ),
  round: (
    <I>
      <path d="M5 20V8.5" opacity=".35" strokeDasharray="1.4 2" />
      <path d="M5 20v-7a8 8 0 0 1 8-8h6" />
      <path d="M5 4.6v.01M19 5v.01" />
    </I>
  ),
  "optical-center": (
    <I>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" opacity=".45" />
      <path d="M12 7v10M7 12h10" opacity=".45" />
      <path d="M8.6 15.4 12 8.6l3.4 6.8z" />
    </I>
  ),
  "snap-grid": (
    <I>
      <path d="M4 4v.01M12 4v.01M20 4v.01M4 12v.01M20 12v.01M4 20v.01M12 20v.01M20 20v.01" strokeWidth={2.2} />
      <path d="M7.5 16.5 12 12" opacity=".5" />
      <rect x="10.3" y="10.3" width="3.4" height="3.4" rx=".6" />
    </I>
  ),
  symmetric: (
    <I>
      <path d="M12 3v18" strokeDasharray="1.6 2.2" />
      <path d="M9.5 5.5C5 7 4 12 5.5 18.5H9.5z" />
      <path d="M14.5 5.5C19 7 20 12 18.5 18.5H14.5z" opacity=".55" />
    </I>
  ),
  wand: (
    <I>
      <path d="M4.5 19.5 14 10" />
      <path d="m14 10 1.6-1.6a1.1 1.1 0 0 0 0-1.6v0a1.1 1.1 0 0 0-1.6 0L12.4 8.4z" />
      <path d="M18 3.5v2.6M16.7 4.8h2.6M19.5 11v2M18.5 12h2M9.5 3.5v2M8.5 4.5h2" />
    </I>
  ),
  ai: (
    <I>
      <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
      <path d="M18.5 16v3M17 17.5h3" />
    </I>
  ),
};
