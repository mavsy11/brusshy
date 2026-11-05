import type { ReactNode } from "react";

/** Extra line icons for palette rows (24×24, 1.5px — same hand as panels/icons.tsx). */
const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const CmdIcons = {
  search: (
    <I>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </I>
  ),
  ai: (
    <I>
      <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
      <path d="M18.5 16v3M17 17.5h3" />
    </I>
  ),
  forward: (
    <I>
      <rect x="4" y="9" width="10" height="10" rx="1.5" opacity=".45" />
      <rect x="10" y="5" width="10" height="10" rx="1.5" fill="var(--paper-lift)" />
    </I>
  ),
  backward: (
    <I>
      <rect x="10" y="5" width="10" height="10" rx="1.5" />
      <rect x="4" y="9" width="10" height="10" rx="1.5" fill="var(--paper-lift)" opacity=".9" strokeDasharray="1.5 2" />
    </I>
  ),
  ruler: (
    <I>
      <path d="M3.5 15.5 15.5 3.5l5 5-12 12z" />
      <path d="m7.5 11.5 2 2M10 9l1.5 1.5M12.5 6.5l2 2" />
    </I>
  ),
  zoomIn: (
    <I>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5M8 10.5h5M10.5 8v5" />
    </I>
  ),
  zoomOut: (
    <I>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5M8 10.5h5" />
    </I>
  ),
  mockup: (
    <I>
      <rect x="3" y="5" width="12" height="9" rx="1.6" transform="rotate(-8 9 9.5)" />
      <rect x="8" y="9" width="12" height="9" rx="1.6" fill="var(--paper-lift)" />
    </I>
  ),
  fonts: (
    <I>
      <path d="M4 18 8.5 6h1L14 18M5.7 14h6.6" />
      <path d="M16 12.5c.6-.9 1.4-1.3 2.4-1.3 1.6 0 2.1 1 2.1 2.3V18m0-3.6c-3.2 0-4.6.7-4.6 2 0 .9.7 1.6 1.8 1.6 1.4 0 2.8-1 2.8-2.6" />
    </I>
  ),
  palette: (
    <I>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.7-.8 1.4-1.8-.4-1.1.3-2.2 1.5-2.2h1.9a3.7 3.7 0 0 0 3.7-3.7C20.5 7.6 16.7 3.5 12 3.5z" />
      <circle cx="7.8" cy="11" r="1" />
      <circle cx="10.5" cy="7.5" r="1" />
      <circle cx="14.8" cy="7.8" r="1" />
    </I>
  ),
  lockup: (
    <I>
      <circle cx="7" cy="12" r="3.5" />
      <path d="M13 10.5h7M13 13.5h5" />
    </I>
  ),
  play: (
    <I>
      <path d="M8 5.5v13l10-6.5z" />
    </I>
  ),
  warp: (
    <I>
      <path d="M4 8c5-3 11-3 16 0M4 16c5 3 11 3 16 0M4 8v8M20 8v8" />
    </I>
  ),
  effects: (
    <I>
      <path d="M7 17.5V6.5h6.5" />
      <path d="M10 20.5V9.5h6.5" opacity=".5" />
      <rect x="4" y="3.5" width="12" height="14" rx="2" strokeDasharray="1.5 2" opacity=".45" />
    </I>
  ),
  sliders: (
    <I>
      <path d="M5 7h14M5 12h14M5 17h14" opacity=".45" />
      <circle cx="9" cy="7" r="1.8" fill="var(--paper-lift)" />
      <circle cx="15" cy="12" r="1.8" fill="var(--paper-lift)" />
      <circle cx="11" cy="17" r="1.8" fill="var(--paper-lift)" />
    </I>
  ),
  doc: (
    <I>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
      <path d="M14 3.5V8h4" />
    </I>
  ),
  recent: (
    <I>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </I>
  ),
};
