import type { ReactNode } from "react";

/** Icons for the quick-win tools, drawn on the same 24×24, 1.5px line grid as icons.tsx. */
const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const QIcons = {
  /** Locked for the AI: a padlock with a small spark in the corner. */
  aiLock: (
    <I>
      <rect x="4" y="11" width="12" height="9" rx="2" />
      <path d="M7 11V8.6a3 3 0 016 0V11" />
      <path d="M18.5 3.2c.3 1.6 1.1 2.4 2.7 2.7-1.6.3-2.4 1.1-2.7 2.7-.3-1.6-1.1-2.4-2.7-2.7 1.6-.3 2.4-1.1 2.7-2.7z" fill="currentColor" stroke="none" />
    </I>
  ),
  aiUnlock: (
    <I>
      <rect x="4" y="11" width="12" height="9" rx="2" />
      <path d="M7 11V8.6a3 3 0 015.8-1.1" />
      <path d="M18.5 3.2c.3 1.6 1.1 2.4 2.7 2.7-1.6.3-2.4 1.1-2.7 2.7-.3-1.6-1.1-2.4-2.7-2.7 1.6-.3 2.4-1.1 2.7-2.7z" />
    </I>
  ),
  /** Outlines (wireframe) view. */
  outlines: (
    <I>
      <path d="M12 3.8l7.2 4.1v8.2L12 20.2l-7.2-4.1V7.9z" />
      <path d="M12 3.8v16.4M4.8 7.9l14.4 8.2M19.2 7.9L4.8 16.1" strokeDasharray="1.4 2.2" />
    </I>
  ),
  code: (
    <I>
      <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.2 5.5l-2.4 13" />
    </I>
  ),
  brief: (
    <I>
      <path d="M7 3.8h7.2l4 4V19a1.2 1.2 0 01-1.2 1.2H7A1.2 1.2 0 015.8 19V5A1.2 1.2 0 017 3.8z" />
      <path d="M14 3.8V8h4.2M9 12h6M9 15h6M9 9h2.5" />
    </I>
  ),
  eyedropper: (
    <I>
      <path d="M14.5 6.5l3 3M16.3 4.7a2 2 0 012.9 2.9l-1.7 1.7-2.9-2.9z" />
      <path d="M15 9L7.4 16.6 5 19l-.6-.6 2.4-2.4L14.4 8.4" />
    </I>
  ),
  copySvg: (
    <I>
      <rect x="8" y="8" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15.5h-.3A1.2 1.2 0 014 14.3V5.2A1.2 1.2 0 015.2 4h9.1a1.2 1.2 0 011.2 1.2v.3" />
      <path d="M11 14.5c1.2-3.4 3.7-3.4 5.5-3.4" />
      <circle cx="11" cy="14.6" r=".9" fill="currentColor" stroke="none" />
    </I>
  ),
  image: (
    <I>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20 15.5l-4.5-4.5L7 19" />
    </I>
  ),
  pixels: (
    <I>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="4" height="4" rx=".6" />
    </I>
  ),
  none: (
    <I>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M6.7 17.3L17.3 6.7" />
    </I>
  ),
  check: (
    <I>
      <path d="M5 12.5l4.2 4.2L19 7" />
    </I>
  ),
};
