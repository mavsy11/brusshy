import type { ReactNode } from "react";

/** Minimal 1.5px line icon set, drawn for Brusshy (24×24 grid). */
const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icons = {
  select: (
    <I>
      <path d="M5.5 3.5l12 6.8-5.2 1.3-2.4 5.1z" />
    </I>
  ),
  node: (
    <I>
      <path d="M4 18C7 8 13 5 20 6" />
      <rect x="2.5" y="16.5" width="3" height="3" rx=".6" />
      <rect x="18.5" y="4.5" width="3" height="3" rx=".6" />
      <path d="M4 18l5-9" strokeDasharray="1.5 2" />
      <circle cx="9.5" cy="8.5" r="1.2" />
    </I>
  ),
  hand: (
    <I>
      <path d="M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5V4.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v6.5c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-1.8-3a1.4 1.4 0 012.3-1.6L8 13" />
    </I>
  ),
  rect: (
    <I>
      <rect x="4.5" y="5.5" width="15" height="13" rx="2.5" />
    </I>
  ),
  ellipse: (
    <I>
      <circle cx="12" cy="12" r="7.5" />
    </I>
  ),
  polygon: (
    <I>
      <path d="M12 4l7.6 5.5-2.9 9H7.3l-2.9-9z" />
    </I>
  ),
  star: (
    <I>
      <path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />
    </I>
  ),
  text: (
    <I>
      <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />
    </I>
  ),
  brush: (
    <I>
      <path d="M14.5 5.5l4 4L10 18a3 3 0 01-4.2 0v0a3 3 0 010-4.2z" />
      <path d="M5.5 18.5c-.8 1.3-2 1.7-2.5 1.5.6-1 .4-2.6 1.4-3.6" />
      <path d="M16.5 3.5l4 4" />
    </I>
  ),
  comment: (
    <I>
      <path d="M12 20.5s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0c0 4.9-6.5 10.5-6.5 10.5z" />
      <path d="M9.5 10h5M12 7.5v5" />
    </I>
  ),
  builder: (
    <I>
      <circle cx="9" cy="9" r="5.5" />
      <circle cx="15" cy="15" r="5.5" />
      <path d="M9.53 14.47A5.5 5.5 0 0 1 14.47 9.53 5.5 5.5 0 0 1 9.53 14.47z" fill="currentColor" stroke="none" />
    </I>
  ),
  image: (
    <I>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5l-5-5L6 19" />
    </I>
  ),
  undo: (
    <I>
      <path d="M8.5 7.5L5 11l3.5 3.5" />
      <path d="M5 11h9.5a4.5 4.5 0 010 9H11" />
    </I>
  ),
  redo: (
    <I>
      <path d="M15.5 7.5L19 11l-3.5 3.5" />
      <path d="M19 11H9.5a4.5 4.5 0 000 9H13" />
    </I>
  ),
  eye: (
    <I>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </I>
  ),
  eyeOff: (
    <I>
      <path d="M4 4l16 16M9.9 6A9.6 9.6 0 0112 5.5C18 5.5 21.5 12 21.5 12a17 17 0 01-2.7 3.4M6.6 7.3C4 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
    </I>
  ),
  lock: (
    <I>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </I>
  ),
  unlock: (
    <I>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 016.8-1.2" />
    </I>
  ),
  group: (
    <I>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" strokeDasharray="2 2.5" />
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
    </I>
  ),
  path: (
    <I>
      <path d="M4.5 17.5c3-9 9-12 15-11" />
      <circle cx="4.5" cy="17.5" r="1.5" />
      <circle cx="19.5" cy="6.5" r="1.5" />
    </I>
  ),
  sketch: (
    <I>
      <path d="M4 15c2-3 3.5-6 5.5-6s.5 6 2.5 6 3-5 5-5 2 3 3 4" />
    </I>
  ),
  export: (
    <I>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 13.5v4A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5v-4" />
    </I>
  ),
  alignLeft: (
    <I>
      <path d="M4.5 4v16" />
      <rect x="7.5" y="6.5" width="10" height="4" rx="1" />
      <rect x="7.5" y="13.5" width="6" height="4" rx="1" />
    </I>
  ),
  alignHCenter: (
    <I>
      <path d="M12 4v16" />
      <rect x="6" y="6.5" width="12" height="4" rx="1" />
      <rect x="8.5" y="13.5" width="7" height="4" rx="1" />
    </I>
  ),
  alignRight: (
    <I>
      <path d="M19.5 4v16" />
      <rect x="6.5" y="6.5" width="10" height="4" rx="1" />
      <rect x="10.5" y="13.5" width="6" height="4" rx="1" />
    </I>
  ),
  alignTop: (
    <I>
      <path d="M4 4.5h16" />
      <rect x="6.5" y="7.5" width="4" height="10" rx="1" />
      <rect x="13.5" y="7.5" width="4" height="6" rx="1" />
    </I>
  ),
  alignVCenter: (
    <I>
      <path d="M4 12h16" />
      <rect x="6.5" y="6" width="4" height="12" rx="1" />
      <rect x="13.5" y="8.5" width="4" height="7" rx="1" />
    </I>
  ),
  alignBottom: (
    <I>
      <path d="M4 19.5h16" />
      <rect x="6.5" y="6.5" width="4" height="10" rx="1" />
      <rect x="13.5" y="10.5" width="4" height="6" rx="1" />
    </I>
  ),
  flipH: (
    <I>
      <path d="M12 3.5v17" strokeDasharray="2 2" />
      <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
    </I>
  ),
  flipV: (
    <I>
      <path d="M3.5 12h17" strokeDasharray="2 2" />
      <path d="M7 9L17 4v5zM7 15l10 5v-5z" />
    </I>
  ),
  frame: (
    <I>
      <path d="M7 3.5v17M17 3.5v17M3.5 7h17M3.5 17h17" />
    </I>
  ),
  copy: (
    <I>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" />
    </I>
  ),
  history: (
    <I>
      <path d="M4.5 12a7.5 7.5 0 102.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9M12 8v4.5l3 2" />
    </I>
  ),
  plus: (
    <I>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  trash: (
    <I>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
    </I>
  ),
  help: (
    <I>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 014.8.9c0 1.7-2.4 2.1-2.4 3.6M12 16.8v.2" />
    </I>
  ),
  cube: (
    <I>
      <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" />
      <path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5" />
    </I>
  ),
  square2d: (
    <I>
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </I>
  ),
  split: (
    <I>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M12 5v14" />
    </I>
  ),
  chevron: (
    <I>
      <path d="M9 6l6 6-6 6" />
    </I>
  ),
  sparkle: (
    <I>
      <path d="M12 3.5c.6 4.3 3.2 6.9 7.5 7.5-4.3.6-6.9 3.2-7.5 7.5-.6-4.3-3.2-6.9-7.5-7.5 4.3-.6 6.9-3.2 7.5-7.5z" />
    </I>
  ),
  fit: (
    <I>
      <path d="M4.5 9V5.5a1 1 0 011-1H9M15 4.5h3.5a1 1 0 011 1V9M19.5 15v3.5a1 1 0 01-1 1H15M9 19.5H5.5a1 1 0 01-1-1V15" />
    </I>
  ),
};

export type IconName = keyof typeof Icons;

export const NODE_ICON: Record<string, IconName> = {
  frame: "frame",
  path: "path",
  shape: "rect",
  text: "text",
  group: "group",
  sketch: "sketch",
  reference: "image",
};
