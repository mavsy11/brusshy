import type { RasterImage } from "../../src";

/**
 * Synthetic "photos" of objects, rendered in code (no real photos, no licences): soft
 * shading, a textured background with a vignette, a cast shadow and sensor noise.
 * Each returns the image and its ground-truth subject mask (for isolation tests).
 */

export interface SyntheticPhoto {
  image: RasterImage;
  /** 1 = subject, at image resolution. */
  truth: Uint8Array;
}

type RGB = [number, number, number];

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise, bilinear, 0–1. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * noise(x * f, y * f, seed + i * 17);
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Render with 3×3 supersampling. `scene(x, y)` returns the color and whether the sample is
 * on the subject (for the truth mask).
 */
function render(W: number, H: number, seed: number, scene: (x: number, y: number) => { c: RGB; subject: boolean }, grain = 6): SyntheticPhoto {
  const data = new Uint8ClampedArray(W * H * 4);
  const truth = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let s = 0;
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          const q = scene(x + (i + 0.5) / 3, y + (j + 0.5) / 3);
          r += q.c[0];
          g += q.c[1];
          b += q.c[2];
          if (q.subject) s++;
        }
      const n = (hash(x, y, seed + 99) - 0.5) * 2 * grain;
      const o = (y * W + x) * 4;
      data[o] = r / 9 + n;
      data[o + 1] = g / 9 + n;
      data[o + 2] = b / 9 + n;
      data[o + 3] = 255;
      truth[y * W + x] = s >= 5 ? 1 : 0;
    }
  return { image: { width: W, height: H, data }, truth };
}

/**
 * A ceramic mug with a colored band and a handle, on a wooden table, light from the left.
 * `busy`: on a red-and-white gingham cloth instead (a background that shares the mug's white).
 */
export function syntheticMug(W = 900, H = 700, busy = false): SyntheticPhoto {
  const u = W / 900;
  const cx = 400 * u;
  const top = 170 * u;
  const bottom = 560 * u;
  const hw = 150 * u; // half width
  const handleC: [number, number] = [cx + hw + 20 * u, 360 * u];
  const handleR = 95 * u;
  const handleT = 26 * u;
  const body: RGB = [236, 232, 224];
  const band: RGB = [214, 74, 46];
  return render(W, H, 7, (x, y) => {
    // Background: warm wood with grain, vignette and a gradient toward the back.
    const grainV = fbm(x / (260 * u), y / (24 * u), 3, 5);
    let bg: RGB = mix([184, 150, 112], [150, 112, 78], grainV);
    if (busy) {
      const a = Math.floor(x / (46 * u)) % 2;
      const b = Math.floor(y / (46 * u)) % 2;
      bg = a && b ? [196, 52, 48] : a || b ? [222, 150, 146] : [240, 236, 230];
    }
    bg = shade(bg, 0.82 + 0.25 * (y / H));
    const vx = (x / W - 0.5) * 1.6;
    const vy = (y / H - 0.5) * 1.6;
    bg = shade(bg, 1 - 0.28 * (vx * vx + vy * vy));
    // Cast shadow: a soft ellipse to the lower right.
    const sdx = (x - (cx + 90 * u)) / (230 * u);
    const sdy = (y - (bottom - 8 * u)) / (55 * u);
    const sh = 1 - smooth(0.55, 1.15, Math.hypot(sdx, sdy));
    bg = shade(bg, 1 - 0.38 * sh);

    // Handle: a ring to the right of the body.
    const hd = Math.abs(Math.hypot(x - handleC[0], y - handleC[1]) - handleR * 0.62);
    const inHandle = hd < handleT && x > cx + hw - 10 * u;
    // Body: a cylinder with an elliptical base and rim.
    const inCol = Math.abs(x - cx) <= hw && y >= top && y <= bottom;
    const eb = ((x - cx) / hw) ** 2 + ((y - bottom) / (22 * u)) ** 2 <= 1;
    const et = ((x - cx) / hw) ** 2 + ((y - top) / (26 * u)) ** 2 <= 1;
    if (inCol || eb || et) {
      const nx = (x - cx) / hw; // −1 … 1
      const lambert = 0.55 + 0.45 * Math.cos((nx + 0.45) * 1.25);
      let c = y > 300 * u && y < 360 * u ? band : body;
      c = shade(c, 0.45 + 0.6 * lambert);
      // Inner rim (the inside of the cup) is darker.
      if (((x - cx) / (hw - 10 * u)) ** 2 + ((y - top) / (20 * u)) ** 2 <= 1) c = shade(body, 0.42 + 0.25 * (1 - nx) / 2);
      return { c, subject: true };
    }
    if (inHandle) {
      const k = 0.55 + 0.4 * (1 - hd / handleT);
      return { c: shade(body, k * 0.95), subject: true };
    }
    return { c: bg, subject: false };
  });
}

/** A dark cat sitting in front of a two-tone backdrop (pale wall over a gray-blue floor). */
export function syntheticCat(W = 800, H = 800): SyntheticPhoto {
  const u = W / 800;
  return render(
    W,
    H,
    11,
    (x, y) => {
      const horizon = 520 * u;
      let bg: RGB = y < horizon ? [232, 226, 214] : [150, 160, 172];
      bg = shade(bg, 0.92 + 0.12 * fbm(x / (90 * u), y / (90 * u), 5, 3));
      // Shadow on the floor.
      const sh = 1 - smooth(0.6, 1.2, Math.hypot((x - 430 * u) / (220 * u), (y - 640 * u) / (40 * u)));
      if (y >= horizon) bg = shade(bg, 1 - 0.35 * sh);
      const head = Math.hypot(x - 400 * u, y - 250 * u) < 95 * u;
      const body = ((x - 410 * u) / (150 * u)) ** 2 + ((y - 480 * u) / (175 * u)) ** 2 < 1 && y < 640 * u;
      const earL = tri(x, y, [318 * u, 210 * u], [330 * u, 110 * u], [385 * u, 165 * u]);
      const earR = tri(x, y, [482 * u, 210 * u], [470 * u, 110 * u], [415 * u, 165 * u]);
      // Tail: a thick arc.
      const td = Math.abs(Math.hypot(x - 600 * u, y - 560 * u) - 90 * u);
      const tail = td < 16 * u && y > 470 * u && y < 650 * u && x > 540 * u;
      if (head || body || earL || earR || tail) {
        const fur = fbm(x / (9 * u), y / (30 * u), 13, 3);
        let c: RGB = mix([38, 36, 40], [70, 64, 60], fur);
        // White chest and muzzle patches.
        if (((x - 400 * u) / (55 * u)) ** 2 + ((y - 380 * u) / (80 * u)) ** 2 < 1) c = mix([226, 222, 214], [190, 186, 180], fur);
        // Eyes.
        if (Math.hypot(x - 365 * u, y - 240 * u) < 13 * u || Math.hypot(x - 435 * u, y - 240 * u) < 13 * u) c = [196, 176, 70];
        const light = 0.85 + 0.3 * (1 - x / W);
        return { c: shade(c, light), subject: true };
      }
      return { c: bg, subject: false };
    },
    7,
  );
}

function tri(x: number, y: number, a: [number, number], b: [number, number], c: [number, number]): boolean {
  const s = (p: [number, number], q: [number, number]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** A pale product bottle on a dark gradient backdrop (subject lighter than the background). */
export function syntheticBottle(W = 700, H = 900): SyntheticPhoto {
  const u = W / 700;
  return render(W, H, 21, (x, y) => {
    const g = 0.6 + 0.5 * (1 - Math.hypot(x / W - 0.45, y / H - 0.4));
    const bg = shade([38, 46, 58], g);
    const cx = 350 * u;
    // Profile: half-width as a function of y (cap, neck, shoulder, body).
    let hw = -1;
    if (y > 120 * u && y < 200 * u) hw = 38 * u;
    else if (y >= 200 * u && y < 290 * u) hw = 30 * u;
    else if (y >= 290 * u && y < 380 * u) hw = 30 * u + (y - 290 * u) * 1.05;
    else if (y >= 380 * u && y < 790 * u) hw = 125 * u;
    if (hw > 0 && Math.abs(x - cx) < hw) {
      const nx = (x - cx) / hw;
      const lam = 0.6 + 0.4 * Math.cos((nx + 0.35) * 1.3);
      let c: RGB = y < 200 * u ? [40, 40, 44] : [228, 236, 232];
      if (y > 480 * u && y < 660 * u && Math.abs(nx) < 0.92) c = [90, 150, 120];
      return { c: shade(c, 0.55 + 0.55 * lam), subject: true };
    }
    return { c: bg, subject: false };
  });
}

/** Intersection over union of a working-resolution mask against the truth (sampled). */
export function maskIoU(mask: { width: number; height: number; data: Uint8Array }, truth: Uint8Array, W: number, H: number): number {
  let inter = 0;
  let uni = 0;
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++) {
      const tx = Math.min(W - 1, Math.floor(((x + 0.5) / mask.width) * W));
      const ty = Math.min(H - 1, Math.floor(((y + 0.5) / mask.height) * H));
      const a = mask.data[y * mask.width + x]!;
      const b = truth[ty * W + tx]!;
      if (a && b) inter++;
      if (a || b) uni++;
    }
  return uni ? inter / uni : 1;
}
