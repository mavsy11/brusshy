import { brandWash, contrast, f, fit, grain, mix, place, roundRect, SH, SW, squircle, wrapScene, type LogoKit } from "./kit";

/* Screen applications: app icon on a phone, browser tab + favicon, social avatar. */

/** The icon tile (squircle or circle) with the mark, gloss and edge. */
function tile(k: LogoKit, x: number, y: number, size: number, shape: "squircle" | "circle", id: string, shadow = ""): string {
  const d = shape === "squircle" ? squircle(x, y, size) : `M${f(x)} ${f(y + size / 2)}a${f(size / 2)} ${f(size / 2)} 0 1 0 ${f(size)} 0a${f(size / 2)} ${f(size / 2)} 0 1 0 ${f(-size)} 0Z`;
  const s = fit(k.tile.art, size * 0.6, size * 0.6);
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>
    <g${shadow ? ` filter="url(#${shadow})"` : ""}><path d="${d}" fill="${k.tile.bg}"/></g>
    <g clip-path="url(#${id})">
      ${place(k.tile.art, x + size / 2 - s.w / 2, y + size / 2 - s.h / 2, s.w, s.h)}
      <rect x="${f(x)}" y="${f(y)}" width="${f(size)}" height="${f(size)}" fill="url(#gloss)"/>
    </g>
    <path d="${d}" fill="none" stroke="${k.tile.border ? "#000" : "#fff"}" stroke-opacity="${k.tile.border ? 0.08 : 0.14}" stroke-width="${f(Math.max(1, size / 140))}"/>`;
}

const GLOSS = `<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.06"/></linearGradient>`;

/** Blurred color blobs for wallpapers. */
function blobs(k: LogoKit, id: string, dark: boolean, items: [number, number, number, number][]): string {
  const base = k.colorful ? k.primary : dark ? "#4a4f58" : "#b9c0c8";
  const second = k.colors.find((c) => c.hex !== k.primary && contrast(c.hex, k.primary) > 1.4)?.hex ?? mix(base, dark ? "#7b6cff" : "#ffd6a8", 0.45);
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <g filter="url(#${id})">${items.map(([cx, cy, r, i]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i ? second : base}" opacity="${dark ? 0.55 : 0.45}"/>`).join("")}</g>`;
}

/* ---------------------------------------------------------------------------------------- */

export function appIcon(k: LogoKit): string {
  const dark = k.dark;
  const fg = dark ? "#ffffff" : "#121315";
  // Phone
  const PX = 250;
  const PY = 70;
  const PW = 520;
  const PH = 1080;
  const B = 14;
  const sx = PX + B;
  const sy = PY + B;
  const sw = PW - 2 * B;
  const sh = PH - 2 * B;
  const screen = roundRect(sx, sy, sw, sh, 64);
  const icon = 88;
  const cols = 4;
  const gap = (sw - 2 * 34 - cols * icon) / (cols - 1);
  const ix = (c: number) => sx + 34 + c * (icon + gap);
  const iy = (r: number) => sy + 124 + r * 132;
  const label = (cx: number, y: number, s: string) =>
    k.text(s.length > 13 ? s.slice(0, 12) + "…" : s, { x: cx, y, size: 15, weight: 500, fill: "#ffffff", anchor: "middle", opacity: 0.95 }) ||
    `<rect x="${cx - 30}" y="${y - 10}" width="60" height="8" rx="4" fill="#fff" opacity="0.8"/>`;
  const ghost = (x: number, y: number, n: number) => {
    const glyphs = [
      `<circle cx="${x + icon / 2}" cy="${y + icon / 2}" r="${icon * 0.2}" fill="#fff" opacity="0.55"/>`,
      `<rect x="${x + icon * 0.3}" y="${y + icon * 0.3}" width="${icon * 0.4}" height="${icon * 0.4}" rx="${icon * 0.1}" fill="#fff" opacity="0.5"/>`,
      `<path d="M${x + icon * 0.28} ${y + icon * 0.66} L${x + icon * 0.5} ${y + icon * 0.3} L${x + icon * 0.72} ${y + icon * 0.66}Z" fill="#fff" opacity="0.5"/>`,
      `<path d="M${x + icon * 0.3} ${y + icon * 0.5} H${x + icon * 0.7} M${x + icon * 0.5} ${y + icon * 0.3} V${y + icon * 0.7}" stroke="#fff" stroke-width="${icon * 0.08}" stroke-linecap="round" opacity="0.5"/>`,
    ];
    return `<path d="${squircle(x, y, icon)}" fill="#fff" opacity="${0.16 + (n % 3) * 0.04}"/>${glyphs[(n * 7 + (n >> 2)) % glyphs.length]}`;
  };
  let grid = "";
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      if (r === 4 && c > 1) continue;
      grid += ghost(ix(c), iy(r), r * 4 + c);
      grid += `<rect x="${ix(c) + icon / 2 - 24}" y="${iy(r) + icon + 14}" width="48" height="7" rx="3.5" fill="#fff" opacity="0.5"/>`;
    }
  const dockY = sy + sh - 150;
  let dock = `<rect x="${sx + 18}" y="${dockY}" width="${sw - 36}" height="122" rx="44" fill="#fff" opacity="0.2"/>`;
  for (let c = 0; c < 4; c++) dock += ghost(ix(c), dockY + 17, c + 7);

  const bigS = 400;
  const bx = 1000;
  const by = 270;
  const sizes = [132, 88, 58];
  let ladder = "";
  let lx = bx + bigS / 2 - (sizes.reduce((a, b) => a + b, 0) + 2 * 40) / 2;
  sizes.forEach((s, i) => {
    ladder += tile(k, lx, 900 - s / 2, s, "squircle", `lad${i}`, "sh-sm");
    lx += s + 40;
  });

  return wrapScene(
    brandWash("wash", k, dark) + brandWash("wall", k, !dark) + GLOSS + `<clipPath id="screen"><path d="${screen}"/></clipPath>`,
    `<rect width="${SW}" height="${SH}" fill="url(#wash)"/>
     ${blobs(k, "bl1", dark, [[200, 200, 260, 0], [1400, 1050, 300, 1], [1300, 150, 180, 1]])}
     ${grain(0, 0, SW, SH, dark ? 0.05 : 0.07, dark)}
     <!-- phone -->
     <g filter="url(#${dark ? "sh-dark" : "sh-lg"})"><path d="${roundRect(PX, PY, PW, PH, 78)}" fill="#0d0e10"/></g>
     <path d="${roundRect(PX + 1.5, PY + 1.5, PW - 3, PH - 3, 77)}" fill="none" stroke="#5b5f66" stroke-width="3"/>
     <rect x="${PX - 4}" y="${PY + 200}" width="5" height="70" rx="2" fill="#2a2c30"/><rect x="${PX - 4}" y="${PY + 290}" width="5" height="70" rx="2" fill="#2a2c30"/>
     <rect x="${PX + PW - 1}" y="${PY + 250}" width="5" height="110" rx="2" fill="#2a2c30"/>
     <g clip-path="url(#screen)">
       <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#wall)"/>
       ${blobs(k, "bl2", !dark, [[sx + 60, sy + 260, 220, 1], [sx + sw, sy + sh - 200, 260, 0], [sx + sw * 0.6, sy + 40, 160, 0]])}
       <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="#000" opacity="${dark ? 0.12 : 0.22}"/>
       ${k.text("9:41", { x: sx + 62, y: sy + 46, size: 21, weight: 600, fill: "#fff" })}
       <rect x="${sx + sw / 2 - 62}" y="${sy + 16}" width="124" height="36" rx="18" fill="#000"/>
       <g fill="#fff">${[0, 1, 2, 3].map((i) => `<rect x="${sx + sw - 132 + i * 8}" y="${sy + 40 - 5 - i * 3}" width="5" height="${5 + i * 3}" rx="1"/>`).join("")}
         <rect x="${sx + sw - 74}" y="${sy + 27}" width="34" height="16" rx="5" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="1.6"/><rect x="${sx + sw - 71}" y="${sy + 30}" width="24" height="10" rx="2.5"/></g>
       ${tile(k, ix(0), iy(0), icon, "squircle", "home", "sh-sm")}
       ${label(ix(0) + icon / 2, iy(0) + icon + 22, k.brand)}
       ${grid}${dock}
       <rect x="${sx + sw / 2 - 70}" y="${sy + sh - 18}" width="140" height="6" rx="3" fill="#fff" opacity="0.8"/>
     </g>
     <!-- big icon -->
     ${tile(k, bx, by, bigS, "squircle", "big", dark ? "sh-dark" : "sh-lg")}
     ${k.text(k.brand, { x: bx + bigS / 2, y: by + bigS + 70, size: 32, weight: 600, fill: fg, anchor: "middle", tracking: -0.01 })}
     ${ladder}`,
  );
}

/* ---------------------------------------------------------------------------------------- */

export async function browserTab(k: LogoKit): Promise<string> {
  const dark = k.dark;
  const bg = dark ? "#131416" : "#e8e6e1";
  const strip = dark ? "#1f2023" : "#dfe1e5";
  const bar = dark ? "#35363a" : "#ffffff";
  const page = dark ? "#18191b" : "#ffffff";
  const text = dark ? "#e8eaed" : "#202124";
  const muted = dark ? "#9aa0a6" : "#5f6368";
  const line = dark ? "#2c2d31" : "#ececec";
  const X = 110;
  const Y = 110;
  const W = 1380;
  const H = 900;
  const win = roundRect(X, Y, W, H, 18);
  // Favicon: the mark as is when it reads on the tab, else on its tile.
  const reads = k.colors.length && k.colors.some((c) => contrast(c.hex, bar) > 2.2);
  const fav = (x: number, y: number, s: number, id: string) => {
    if (reads) {
      const a = fit(k.mark, s, s);
      return place(k.mark, x + (s - a.w) / 2, y + (s - a.h) / 2, a.w, a.h);
    }
    const ts = fit(k.tile.art, s * 0.72, s * 0.72);
    return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.22}" fill="${k.tile.bg}"/>${place(k.tile.art, x + (s - ts.w) / 2, y + (s - ts.h) / 2, ts.w, ts.h)}<!--${id}-->`;
  };
  const tabY = Y + 14;
  const tabH = 50;
  const tab1 = X + 110;
  const tabW = 300;
  const title = k.brand.length > 22 ? k.brand.slice(0, 21) + "…" : k.brand;
  const inactive = (x: number) => `<circle cx="${x + 26}" cy="${tabY + tabH / 2}" r="9" fill="${muted}" opacity="0.5"/><rect x="${x + 46}" y="${tabY + tabH / 2 - 4}" width="140" height="8" rx="4" fill="${muted}" opacity="0.35"/><rect x="${x + 238}" y="${tabY + 14}" width="1.5" height="22" fill="${muted}" opacity="0.3"/>`;
  const readsOnPage = k.colors.some((c) => contrast(c.hex, page) > 2.2);
  const fullOnPage = readsOnPage ? k.on(page, "full") : k.mono(text, "full", page);
  const navArt = readsOnPage ? k.on(page, "lockup") : k.mono(text, "lockup", page);
  const ls = fit(navArt, 230, 46);
  const heroArt = fullOnPage;
  const hs = fit(heroArt, 420, 260);
  const accent = k.colorful && contrast(k.primary, page) > 2 ? k.primary : text;
  const onAccent = contrast(accent, "#ffffff") > contrast(accent, "#111") ? "#ffffff" : "#111111";

  const [p16, p32] = await Promise.all([k.px(16), k.px(32)]);
  const CX = 1090;
  const CY = 760;
  const card = `
    <g filter="url(#sh-lg)"><rect x="${CX}" y="${CY}" width="420" height="300" rx="20" fill="${dark ? "#202125" : "#ffffff"}"/></g>
    ${k.text("FAVICON AT REAL SIZE", { x: CX + 30, y: CY + 46, size: 13, weight: 600, fill: muted, tracking: 0.14 })}
    <rect x="${CX + 30}" y="${CY + 74}" width="160" height="160" rx="12" fill="${dark ? "#2a2b30" : "#f3f4f5"}"/>
    <image href="${p16}" x="${CX + 46}" y="${CY + 90}" width="128" height="128" style="image-rendering:pixelated" image-rendering="pixelated"/>
    <rect x="${CX + 230}" y="${CY + 74}" width="160" height="160" rx="12" fill="${dark ? "#2a2b30" : "#f3f4f5"}"/>
    <image href="${p32}" x="${CX + 246}" y="${CY + 90}" width="128" height="128" style="image-rendering:pixelated" image-rendering="pixelated"/>
    ${k.text("16 px  ×8", { x: CX + 110, y: CY + 266, size: 15, weight: 500, fill: text, anchor: "middle" })}
    ${k.text("32 px  ×4", { x: CX + 310, y: CY + 266, size: 15, weight: 500, fill: text, anchor: "middle" })}`;

  return wrapScene(
    `<clipPath id="win"><path d="${win}"/></clipPath><radialGradient id="bgl" cx="0.3" cy="0.1" r="1.1"><stop offset="0" stop-color="${mix(bg, "#ffffff", dark ? 0.06 : 0.4)}"/><stop offset="1" stop-color="${mix(bg, "#000000", dark ? 0.3 : 0.08)}"/></radialGradient>`,
    `<rect width="${SW}" height="${SH}" fill="url(#bgl)"/>${grain(0, 0, SW, SH, dark ? 0.04 : 0.07, dark)}
     <g filter="url(#${dark ? "sh-dark" : "sh-lg"})"><path d="${win}" fill="${page}"/></g>
     <g clip-path="url(#win)">
       <rect x="${X}" y="${Y}" width="${W}" height="${tabY + tabH - Y}" fill="${strip}"/>
       ${["#ff5f57", "#febc2e", "#28c840"].map((c, i) => `<circle cx="${X + 30 + i * 24}" cy="${tabY + tabH / 2}" r="7.5" fill="${c}"/>`).join("")}
       <path d="M${tab1 - 12} ${tabY + tabH} Q${tab1} ${tabY + tabH} ${tab1} ${tabY + tabH - 12} V${tabY + 12} Q${tab1} ${tabY} ${tab1 + 12} ${tabY} H${tab1 + tabW - 12} Q${tab1 + tabW} ${tabY} ${tab1 + tabW} ${tabY + 12} V${tabY + tabH - 12} Q${tab1 + tabW} ${tabY + tabH} ${tab1 + tabW + 12} ${tabY + tabH}Z" fill="${bar}"/>
       ${fav(tab1 + 16, tabY + tabH / 2 - 12, 24, "tab")}
       ${k.text(title, { x: tab1 + 52, y: tabY + tabH / 2 + 6, size: 16, weight: 500, fill: text })}
       <path d="M${tab1 + tabW - 30} ${tabY + 19} l12 12 M${tab1 + tabW - 18} ${tabY + 19} l-12 12" stroke="${muted}" stroke-width="1.6" stroke-linecap="round"/>
       ${inactive(tab1 + tabW + 12)}${inactive(tab1 + tabW + 262)}
       <path d="M${tab1 + tabW + 530} ${tabY + 25} h16 M${tab1 + tabW + 538} ${tabY + 17} v16" stroke="${muted}" stroke-width="1.8" stroke-linecap="round"/>
       <rect x="${X}" y="${tabY + tabH}" width="${W}" height="62" fill="${bar}"/>
       <g stroke="${muted}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
         <path d="M${X + 38} ${tabY + tabH + 31} h16 M${X + 38} ${tabY + tabH + 31} l7 -7 M${X + 38} ${tabY + tabH + 31} l7 7"/>
         <path d="M${X + 100} ${tabY + tabH + 31} h-16 M${X + 100} ${tabY + tabH + 31} l-7 -7 M${X + 100} ${tabY + tabH + 31} l-7 7" opacity="0.45"/>
         <path d="M${X + 148} ${tabY + tabH + 24} a9 9 0 1 0 2 8 M${X + 150} ${tabY + tabH + 19} v6 h-6"/>
       </g>
       <rect x="${X + 182}" y="${tabY + tabH + 11}" width="${W - 260}" height="40" rx="20" fill="${dark ? "#202124" : "#f1f3f4"}"/>
       <path d="M${X + 206} ${tabY + tabH + 30} v-4 a5 5 0 0 1 10 0 v4 M${X + 203} ${tabY + tabH + 30} h16 v10 h-16z" fill="none" stroke="${muted}" stroke-width="1.7" stroke-linejoin="round"/>
       ${k.text(k.domain, { x: X + 232, y: tabY + tabH + 37, size: 17, weight: 400, fill: text })}
       <rect x="${X}" y="${tabY + tabH + 62}" width="${W}" height="1" fill="${line}"/>
       <!-- page -->
       ${place(navArt, X + 70, Y + 193 - ls.h / 2, ls.w, ls.h)}
       ${[0, 1, 2].map((i) => `<rect x="${X + W - 470 + i * 110}" y="${Y + 188}" width="78" height="9" rx="4.5" fill="${muted}" opacity="0.5"/>`).join("")}
       <rect x="${X + W - 150}" y="${Y + 174}" width="96" height="38" rx="19" fill="${accent}"/>
       <rect x="${X + W - 126}" y="${Y + 189}" width="48" height="8" rx="4" fill="${onAccent}" opacity="0.85"/>
       ${place(heroArt, X + W * 0.62 - hs.w / 2, Y + 300, hs.w, hs.h)}
       ${k.text(`Meet ${title}.`, { x: X + 70, y: Y + 380, size: 58, weight: 600, fill: text, tracking: -0.03 })}
       <rect x="${X + 72}" y="${Y + 420}" width="420" height="12" rx="6" fill="${muted}" opacity="0.3"/>
       <rect x="${X + 72}" y="${Y + 446}" width="360" height="12" rx="6" fill="${muted}" opacity="0.3"/>
       <rect x="${X + 72}" y="${Y + 500}" width="168" height="52" rx="26" fill="${accent}"/>
       <rect x="${X + 110}" y="${Y + 522}" width="92" height="9" rx="4.5" fill="${onAccent}" opacity="0.85"/>
       ${[0, 1, 2].map((i) => `<rect x="${X + 70 + i * 420}" y="${Y + 640}" width="390" height="200" rx="16" fill="${dark ? "#202125" : "#f6f6f4"}"/>`).join("")}
     </g>
     ${card}`,
  );
}

/* ---------------------------------------------------------------------------------------- */

export function avatar(k: LogoKit): string {
  const dark = k.dark;
  const bg = dark ? "#121315" : "#ebe8e3";
  const card = dark ? "#1a1b1e" : "#ffffff";
  const text = dark ? "#f1f2f3" : "#0f1419";
  const muted = dark ? "#8b9096" : "#6b7378";
  const X = 150;
  const Y = 220;
  const W = 820;
  const H = 760;
  const bannerH = 280;
  const ring = card;
  const A = 230;
  const ax = X + 60;
  const ay = Y + bannerH - A / 2;
  const watermark = k.mono("#ffffff", "mark", k.colorful ? k.primary : "#2a2c31");
  const wm = fit(watermark, 420, 420);
  const accent = k.colorful ? k.primary : dark ? "#e8eaed" : "#0f1419";
  const onAccent = contrast(accent, "#fff") > contrast(accent, "#111") ? "#ffffff" : "#111111";
  const nameW = k.textWidth(k.brand, { size: 40, weight: 600 });
  const sizes: [number, string][] = [
    [180, "Profile"],
    [112, "Post"],
    [72, "Reply"],
    [44, "Mention"],
  ];
  let ladder = "";
  let ly = 230;
  sizes.forEach(([s, label], i) => {
    const cx = 1290;
    ladder += tile(k, cx - s / 2, ly, s, "circle", `av${i}`, "sh-sm");
    ladder += k.text(label, { x: cx + 120, y: ly + s / 2 + 6, size: 18, weight: 500, fill: muted });
    ly += s + 56;
  });
  return wrapScene(
    brandWash("banner", k, true) + GLOSS + `<clipPath id="card"><path d="${roundRect(X, Y, W, H, 28)}"/></clipPath>`,
    `<rect width="${SW}" height="${SH}" fill="${bg}"/>${grain(0, 0, SW, SH, dark ? 0.04 : 0.07, dark)}
     <g filter="url(#${dark ? "sh-dark" : "sh-lg"})"><path d="${roundRect(X, Y, W, H, 28)}" fill="${card}"/></g>
     <g clip-path="url(#card)">
       <rect x="${X}" y="${Y}" width="${W}" height="${bannerH}" fill="url(#banner)"/>
       <g opacity="0.1">${place(watermark, X + W - wm.w * 0.75, Y + bannerH / 2 - wm.h / 2, wm.w, wm.h, ' data-decor="1"')}</g>
       ${grain(X, Y, W, bannerH, 0.08, true)}
     </g>
     <circle cx="${ax + A / 2}" cy="${ay + A / 2}" r="${A / 2 + 8}" fill="${ring}"/>
     ${tile(k, ax, ay, A, "circle", "pfp")}
     <rect x="${X + W - 220}" y="${Y + bannerH + 30}" width="160" height="52" rx="26" fill="${accent}"/>
     ${k.text("Follow", { x: X + W - 140, y: Y + bannerH + 63, size: 19, weight: 600, fill: onAccent, anchor: "middle" })}
     ${k.text(k.brand, { x: X + 60, y: Y + bannerH + 180, size: 40, weight: 600, fill: text, tracking: -0.02 })}
     <circle cx="${X + 60 + nameW + 26}" cy="${Y + bannerH + 166}" r="14" fill="${k.colorful ? k.primary : "#1d9bf0"}"/>
     <path d="M${X + 60 + nameW + 19} ${Y + bannerH + 166} l5 5 l9 -10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
     ${k.text(k.handle, { x: X + 60, y: Y + bannerH + 218, size: 22, weight: 400, fill: muted })}
     <rect x="${X + 60}" y="${Y + bannerH + 262}" width="620" height="12" rx="6" fill="${muted}" opacity="0.28"/>
     <rect x="${X + 60}" y="${Y + bannerH + 290}" width="470" height="12" rx="6" fill="${muted}" opacity="0.28"/>
     ${k.text(k.domain, { x: X + 60, y: Y + bannerH + 350, size: 20, weight: 500, fill: accent === onAccent ? text : k.colorful ? k.primary : text })}
     <rect x="${X}" y="${Y + bannerH + 400}" width="${W}" height="1" fill="${muted}" opacity="0.2"/>
     ${[0, 1].map((i) => `<rect x="${X + 60 + i * 200}" y="${Y + bannerH + 440}" width="${120 - i * 10}" height="11" rx="5.5" fill="${muted}" opacity="0.3"/>`).join("")}
     ${ladder}`,
  );
}
