import { contrast, f, fit, grain, mix, place, roundRect, SH, SW, wrapScene, type Art, type LogoKit } from "./kit";

/* Physical applications: business cards, letterhead, tote, storefront. */

const PAPER = "#fbfaf6";
const INK = "#121315";

/** Desk surface: soft daylight from the top left, mottled and grainy. */
function desk(dark: boolean): { defs: string; body: string } {
  const defs = dark
    ? `<radialGradient id="desk" cx="0.32" cy="0.22" r="1.05"><stop offset="0" stop-color="#2a2b2f"/><stop offset="0.6" stop-color="#18191c"/><stop offset="1" stop-color="#0e0f11"/></radialGradient>`
    : `<radialGradient id="desk" cx="0.3" cy="0.2" r="1.1"><stop offset="0" stop-color="#f2efe9"/><stop offset="0.55" stop-color="#e4dfd6"/><stop offset="1" stop-color="#cfc8bc"/></radialGradient>`;
  const body = `<rect width="${SW}" height="${SH}" fill="url(#desk)"/>
    <rect width="${SW}" height="${SH}" filter="url(#mottle)" opacity="${dark ? 0.12 : 0.07}"/>
    ${grain(0, 0, SW, SH, dark ? 0.05 : 0.09, dark)}`;
  return { defs, body };
}

/** Light falling across a sheet (top-left bright, bottom-right slightly shaded). */
const sheetLight = (id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.07"/></linearGradient>`;

/** A sheet of card/paper centered at (cx, cy), rotated, with shadow, lighting, grain and a crisp edge. */
function sheet(o: { id: string; cx: number; cy: number; w: number; h: number; rot: number; color: string; r?: number; content: string; shadow?: string }): string {
  const { id, w, h } = o;
  const x = -w / 2;
  const y = -h / 2;
  const r = o.r ?? 8;
  const shape = roundRect(x, y, w, h, r);
  const darkSheet = contrast(o.color, "#000000") < 6;
  return `<clipPath id="${id}-clip"><path d="${shape}"/></clipPath>
    <g filter="url(#${o.shadow ?? "sh-lg"})"><g transform="translate(${f(o.cx)} ${f(o.cy)}) rotate(${o.rot})">
      <path d="${shape}" fill="${o.color}"/>
      <g clip-path="url(#${id}-clip)">
        ${o.content}
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sheet-light)"/>
        ${grain(x, y, w, h, darkSheet ? 0.07 : 0.1, darkSheet)}
      </g>
      <path d="${roundRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2, r)}" fill="none" stroke="#ffffff" stroke-opacity="${darkSheet ? 0.08 : 0.55}" stroke-width="1.2"/>
    </g></g>`;
}

/** Ink (one color) that reads on a surface. */
const inkOn = (surface: string) => (contrast(surface, "#ffffff") >= contrast(surface, INK) ? "#ffffff" : INK);

/** Gray "text" lines (placeholder copy). */
function lines(x: number, y: number, widths: number[], color: string, h = 7, gap = 21, opacity = 1): string {
  return widths.map((w, i) => `<rect x="${f(x)}" y="${f(y + i * gap)}" width="${f(w)}" height="${h}" rx="${h / 2}" fill="${color}" opacity="${opacity}"/>`).join("");
}

/** Full-color art when it reads on the surface, else a one-color version. */
function artOn(k: LogoKit, surface: string, which: "full" | "mark" | "lockup" = "full"): Art {
  const a = which === "full" ? k.full : which === "lockup" ? k.lockup : k.mark;
  // The dominant color carries the logo's silhouette: it must read on the surface.
  const dom = k.colors[0];
  return !dom || contrast(dom.hex, surface) >= 2.2 ? k.on(surface, which) : k.mono(inkOn(surface), which, surface);
}

/* ---------------------------------------------------------------------------------------- */

export function businessCards(k: LogoKit): string {
  const d = desk(k.dark);
  const front = k.lum > 0.6 ? "#141517" : PAPER;
  // The back carries the brand color when there is one, else the inverse of the front.
  const back = k.colorful ? k.primary : front === PAPER ? "#141517" : PAPER;
  const backInk = inkOn(back);
  const W = 700;
  const H = 400;

  const fa = artOn(k, front);
  const fs = fit(fa, W * 0.6, H * 0.5);
  const frontContent = place(fa, -fs.w / 2, -fs.h / 2, fs.w, fs.h);

  const ma = k.mono(backInk, "mark", back);
  const ms = fit(ma, 74, 74);
  const sub = backInk === "#ffffff" ? "rgba(255,255,255,0.72)" : "rgba(18,19,21,0.66)";
  const backContent = `
    ${place(ma, -W / 2 + 56, -H / 2 + 56, ms.w, ms.h)}
    ${k.text(k.brand, { x: -W / 2 + 56, y: 58, size: 30, weight: 600, fill: backInk, tracking: -0.01 }) || `<rect x="${-W / 2 + 56}" y="34" width="220" height="16" rx="8" fill="${backInk}"/>`}
    ${k.text(`hello@${k.domain}`, { x: -W / 2 + 56, y: 100, size: 17, weight: 400, fill: sub }) || lines(-W / 2 + 56, 88, [200], sub)}
    ${k.text(k.domain, { x: -W / 2 + 56, y: 128, size: 17, weight: 400, fill: sub }) || lines(-W / 2 + 56, 116, [140], sub)}
    ${k.text(k.handle, { x: W / 2 - 56, y: 128, size: 17, weight: 400, fill: sub, anchor: "end" })}`;

  return wrapScene(
    d.defs + sheetLight("sheet-light"),
    `${d.body}
     ${sheet({ id: "back", cx: 610, cy: 455, w: W, h: H, rot: -9, color: back, content: backContent })}
     ${sheet({ id: "front", cx: 960, cy: 735, w: W, h: H, rot: 5, color: front, content: frontContent })}`,
  );
}

/* ---------------------------------------------------------------------------------------- */

export function letterhead(k: LogoKit): string {
  const d = desk(k.dark);
  const paper = PAPER;
  const gray = "#cfd2d5";
  const W = 640;
  const H = Math.round(W * Math.SQRT2);
  const x = -W / 2;
  const y = -H / 2;
  const la = artOn(k, paper, "lockup");
  const ls = fit(la, 240, 58);
  const accent = k.colorful ? k.primary : INK;
  const letter = `
    ${place(la, x + 58, y + 62, ls.w, ls.h)}
    ${k.text(k.domain, { x: -x - 58, y: y + 80, size: 12, weight: 500, fill: "#7a8085", anchor: "end" })}
    ${k.text(k.handle, { x: -x - 58, y: y + 98, size: 12, weight: 400, fill: "#9aa0a5", anchor: "end" })}
    ${lines(x + 58, y + 190, [150], "#9aa0a5", 6)}
    ${lines(x + 58, y + 250, [120], "#8c9297", 7)}
    ${lines(x + 58, y + 300, [500, 520, 488, 512, 300], gray, 6, 20)}
    ${lines(x + 58, y + 420, [516, 498, 520, 470, 508, 240], gray, 6, 20)}
    ${lines(x + 58, y + 560, [505, 520, 260], gray, 6, 20)}
    ${lines(x + 58, y + 660, [90], "#8c9297", 7)}
    <rect x="${x + 58}" y="${-y - 74}" width="${W - 116}" height="1" fill="${gray}"/>
    <rect x="${x + 58}" y="${-y - 75}" width="46" height="3" fill="${accent}"/>
    ${k.text(`${k.brand}  ·  ${k.domain}`, { x: x + 58, y: -y - 46, size: 11, weight: 400, fill: "#9aa0a5" })}`;

  // DL envelope (front): logo top-left, address block, stamp box.
  const EW = 700;
  const EH = 350;
  const ex = -EW / 2;
  const ey = -EH / 2;
  const ea = artOn(k, paper, "lockup");
  const es = fit(ea, 170, 40);
  const envelope = `
    ${place(ea, ex + 34, ey + 32, es.w, es.h)}
    <rect x="${-ex - 104}" y="${ey + 28}" width="70" height="84" rx="3" fill="none" stroke="#c4c8cb" stroke-width="1.5" stroke-dasharray="4 4"/>
    ${lines(-40, 20, [220, 180, 200], "#bfc3c6", 7, 22)}`;

  return wrapScene(
    d.defs + sheetLight("sheet-light"),
    `${d.body}
     ${sheet({ id: "letter", cx: 700, cy: 600, w: W, h: H, rot: -4, color: paper, r: 2, content: letter })}
     ${sheet({ id: "env", cx: 1110, cy: 880, w: EW, h: EH, rot: 8, color: mix(paper, "#e9e2d4", 0.45), r: 4, content: envelope })}`,
  );
}

/* ---------------------------------------------------------------------------------------- */

export function tote(k: LogoKit): string {
  const dark = k.dark || k.lum > 0.6;
  const canvas = dark ? "#202124" : "#e9e0cd";
  const shade = mix(canvas, "#000000", dark ? 0.35 : 0.18);
  const bg = k.dark
    ? `<radialGradient id="bd" cx="0.5" cy="0.42" r="0.75"><stop offset="0" stop-color="#2b2c30"/><stop offset="1" stop-color="#0f1012"/></radialGradient>`
    : `<radialGradient id="bd" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#f4f2ee"/><stop offset="0.7" stop-color="#e3dfd8"/><stop offset="1" stop-color="#d3cdc3"/></radialGradient>`;
  // Bag body with gently bowed sides.
  const L = 520;
  const R = 1080;
  const T = 400;
  const B = 1090;
  const body = `M${L} ${T} L${R} ${T} C${R + 6} ${T + 240} ${R + 10} ${B - 160} ${R + 4} ${B - 14} Q${R + 2} ${B} ${R - 14} ${B} L${L + 14} ${B} Q${L - 2} ${B} ${L - 4} ${B - 14} C${L - 10} ${B - 160} ${L - 6} ${T + 240} ${L} ${T}Z`;
  const strap = (x1: number, x2: number, top: number) =>
    `M${x1} ${T + 30} C${x1} ${top + 60} ${x1 + 20} ${top} ${(x1 + x2) / 2} ${top} C${x2 - 20} ${top} ${x2} ${top + 60} ${x2} ${T + 30}`;
  const pa = artOn(k, canvas);
  const ps = fit(pa, 330, 300);
  const folds = `<linearGradient id="folds" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.16"/><stop offset="0.08" stop-color="#000" stop-opacity="0.02"/>
      <stop offset="0.3" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.46" stop-color="#000" stop-opacity="0.03"/>
      <stop offset="0.62" stop-color="#fff" stop-opacity="0.06"/><stop offset="0.86" stop-color="#000" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.2"/></linearGradient>
    <linearGradient id="drape" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient>
    <filter id="weave" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1 0.35" numOctaves="2" seed="5"/>
      <feColorMatrix values="0 0 0 0 ${dark ? 1 : 0}  0 0 0 0 ${dark ? 1 : 0}  0 0 0 0 ${dark ? 1 : 0}  1.6 0 0 0 -0.6"/></filter>
    <filter id="print" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="9" result="t"/>
      <feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter>
    <clipPath id="bag"><path d="${body}"/></clipPath>
    <filter id="soft" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="16"/></filter>`;
  return wrapScene(
    bg + folds,
    `<rect width="${SW}" height="${SH}" fill="url(#bd)"/>${grain(0, 0, SW, SH, k.dark ? 0.04 : 0.07, k.dark)}
     <ellipse cx="800" cy="1096" rx="300" ry="20" fill="#000" opacity="${k.dark ? 0.6 : 0.22}" filter="url(#soft)"/>
     <path d="${strap(600, 1000, 96)}" fill="none" stroke="${shade}" stroke-width="40" stroke-linecap="butt"/>
     <g filter="url(#${k.dark ? "sh-dark" : "sh-lg"})">
       <path d="${body}" fill="${canvas}"/>
       <g clip-path="url(#bag)">
         <g opacity="0.93" filter="url(#print)">${place(pa, 800 - ps.w / 2, 730 - ps.h / 2, ps.w, ps.h)}</g>
         <rect x="${L - 20}" y="${T}" width="${R - L + 40}" height="${B - T}" filter="url(#weave)" opacity="${dark ? 0.1 : 0.2}"/>
         <rect x="${L - 20}" y="${T}" width="${R - L + 40}" height="${B - T}" fill="url(#folds)"/>
         <rect x="${L - 20}" y="${T}" width="${R - L + 40}" height="${B - T}" fill="url(#drape)"/>
         <rect x="${L - 20}" y="${T}" width="${R - L + 40}" height="52" fill="#000" opacity="0.06"/>
         <line x1="${L + 8}" y1="${T + 44}" x2="${R - 8}" y2="${T + 44}" stroke="${dark ? "#fff" : "#000"}" stroke-opacity="0.22" stroke-width="1.6" stroke-dasharray="6 5"/>
         <line x1="${L + 8}" y1="${T + 10}" x2="${R - 8}" y2="${T + 10}" stroke="${dark ? "#fff" : "#000"}" stroke-opacity="0.16" stroke-width="1.4" stroke-dasharray="6 5"/>
       </g>
     </g>
     <path d="${strap(680, 920, 150)}" fill="none" stroke="${canvas}" stroke-width="40"/>
     <path d="${strap(680, 920, 150)}" fill="none" stroke="url(#folds)" stroke-width="40"/>
     <path d="${strap(680, 920, 150)}" fill="none" stroke="${dark ? "#fff" : "#000"}" stroke-opacity="0.18" stroke-width="1.4" stroke-dasharray="6 5" transform="translate(0 0)"/>
     ${[680, 920].map((x) => `<rect x="${x - 24}" y="${T + 6}" width="48" height="58" rx="3" fill="${canvas}" stroke="${dark ? "#fff" : "#000"}" stroke-opacity="0.16" stroke-dasharray="5 4"/>`).join("")}`,
  );
}

/* ---------------------------------------------------------------------------------------- */

export function storefront(k: LogoKit): string {
  const night = k.dark;
  const wall = night ? "#2a2c30" : "#e7dfd2";
  const board = "#151619";
  const signArt = k.lum > 0.55 ? k.on(board, "lockup") : k.mono("#f4efe6", "lockup", board);
  const ss = fit(signArt, 860, 112);
  const glassTop = night ? "#1d2126" : "#a8b6c2";
  const glassBot = night ? "#3a2f24" : "#56636e";
  const metal = night ? "#0c0d0f" : "#1c1d20";
  const winY = 470;
  const winB = 1070;
  const defs = `
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(wall, "#ffffff", night ? 0.04 : 0.25)}"/><stop offset="1" stop-color="${mix(wall, "#000000", night ? 0.3 : 0.1)}"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${glassTop}"/><stop offset="1" stop-color="${glassBot}"/></linearGradient>
    <linearGradient id="refl" x1="0" y1="0" x2="1" y2="1"><stop offset="0.25" stop-color="#fff" stop-opacity="0"/><stop offset="0.32" stop-color="#fff" stop-opacity="${night ? 0.05 : 0.16}"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/><stop offset="0.58" stop-color="#fff" stop-opacity="${night ? 0.04 : 0.1}"/><stop offset="0.62" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="1" r="0.9"><stop offset="0" stop-color="#ffcf8a" stop-opacity="${night ? 0.55 : 0.12}"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
    <clipPath id="boardClip"><rect x="200" y="190" width="1200" height="200" rx="4"/></clipPath>
    <radialGradient id="cone" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6e2" stop-opacity="${night ? 0.3 : 0.16}"/><stop offset="1" stop-color="#fff6e2" stop-opacity="0"/></radialGradient>
    <linearGradient id="boardLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.02"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></linearGradient>
    <linearGradient id="walk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${night ? "#1c1d20" : "#c9c3b9"}"/><stop offset="1" stop-color="${night ? "#0f1012" : "#b3aca1"}"/></linearGradient>`;

  const pane = (x: number, w: number) => `
    <rect x="${x}" y="${winY}" width="${w}" height="${winB - winY}" fill="url(#glass)"/>
    <rect x="${x}" y="${winY}" width="${w}" height="${winB - winY}" fill="url(#glow)"/>
    <rect x="${x}" y="${winY}" width="${w}" height="${winB - winY}" fill="url(#refl)"/>`;
  const doorX = 1110;
  const doorW = 250;
  const decal = k.mono("#ffffff", "mark", night ? "#2b2a29" : "#7f8c97");
  const ds = fit(decal, 110, 110);
  const blade = k.tile;
  const bs = fit(blade.art, 120, 120);
  const lamp = (x: number) => `
    <path d="M${x} 168 C${x} 120 ${x + 50} 112 ${x + 64} 150" fill="none" stroke="${metal}" stroke-width="6" stroke-linecap="round"/>
    <path d="M${x + 46} 146 L${x + 84} 146 L${x + 76} 162 L${x + 54} 162Z" fill="${metal}"/>
    <ellipse cx="${x + 65}" cy="190" rx="230" ry="190" fill="url(#cone)" clip-path="url(#boardClip)"/>`;

  return wrapScene(
    defs,
    `<rect width="${SW}" height="${SH}" fill="url(#wall)"/>
     <rect width="${SW}" height="${SH}" filter="url(#mottle)" opacity="${night ? 0.14 : 0.1}"/>
     ${grain(0, 0, SW, SH, night ? 0.06 : 0.12, night)}
     <!-- fascia -->
     <g filter="url(#sh-md)"><rect x="200" y="190" width="1200" height="200" rx="4" fill="${board}"/></g>
     <rect x="200" y="190" width="1200" height="200" rx="4" fill="url(#boardLight)"/>
     <rect x="214" y="204" width="1172" height="172" rx="2" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="2"/>
     ${place(signArt, 800 - ss.w / 2, 290 - ss.h / 2, ss.w, ss.h)}
     ${lamp(380)}${lamp(740)}${lamp(1100)}
     <!-- shop front -->
     <g filter="url(#sh-sm)"><rect x="190" y="${winY - 22}" width="1220" height="${winB - winY + 22}" fill="${metal}"/></g>
     ${pane(212, 420)}${pane(652, 420)}${pane(doorX, doorW)}
     <rect x="${doorX - 18}" y="${winY - 22}" width="18" height="${winB - winY + 22}" fill="${metal}"/>
     <rect x="${doorX + doorW}" y="${winY - 22}" width="${1410 - doorX - doorW}" height="${winB - winY + 22}" fill="${metal}"/>
     <rect x="${doorX + doorW - 46}" y="740" width="10" height="150" rx="5" fill="#c9cdd1"/>
     <g opacity="0.9">${place(decal, doorX + doorW / 2 - ds.w / 2, 640 - ds.h / 2, ds.w, ds.h)}</g>
     ${k.text("OPEN", { x: doorX + doorW / 2, y: 735, size: 18, weight: 600, fill: "#ffffff", anchor: "middle", tracking: 0.3, opacity: 0.75 })}
     <rect x="190" y="${winB}" width="1220" height="18" fill="${mix(wall, "#000", 0.35)}"/>
     <!-- blade sign -->
     <path d="M40 520 H190" stroke="${metal}" stroke-width="8" stroke-linecap="round"/>
     <path d="M60 520 L98 560 M170 520 L132 560" stroke="${metal}" stroke-width="3"/>
     <g filter="url(#sh-md)"><circle cx="115" cy="652" r="92" fill="${blade.bg}"/></g>
     <circle cx="115" cy="652" r="92" fill="none" stroke="${metal}" stroke-width="6"/>
     ${place(blade.art, 115 - bs.w / 2, 652 - bs.h / 2, bs.w, bs.h)}
     <!-- sidewalk -->
     <rect x="0" y="${winB + 18}" width="${SW}" height="${SH - winB - 18}" fill="url(#walk)"/>
     ${[0, 260, 520, 780, 1040, 1300, 1560].map((x) => `<line x1="${x}" y1="${winB + 18}" x2="${x - 40}" y2="${SH}" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>`).join("")}
     ${grain(0, winB + 18, SW, SH - winB, 0.12, night)}`,
  );
}
