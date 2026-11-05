import * as THREE from "three";

/**
 * Backgrounds go through the same HDR → tone-mapped pipeline as the logo (so
 * glass refracts them and bloom spills over them). To keep the user's exact
 * hex on screen, we feed the inverse of Khronos PBR Neutral tone mapping.
 */

function neutral(c: number[], exposure: number): number[] {
  const start = 0.8 - 0.04;
  const desat = 0.15;
  let [r, g, b] = c.map((v) => v * exposure) as [number, number, number];
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset;
  g -= offset;
  b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < start) return [r, g, b];
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  const k = newPeak / peak;
  r *= k;
  g *= k;
  b *= k;
  const t = 1 - 1 / (desat * (peak - newPeak) + 1);
  return [r + (newPeak - r) * t, g + (newPeak - g) * t, b + (newPeak - b) * t];
}

/** Linear color that, after exposure + Neutral tone mapping, displays as `css`. */
export function preToneMapped(css: string, exposure: number): THREE.Color {
  const target = new THREE.Color(css); // linear working space
  const t = [target.r, target.g, target.b].map((v) => Math.min(Math.max(v, 0), 0.996));
  const x = t.map((v) => v / exposure);
  // Gauss–Seidel: bisect each channel (monotonic in its own input) holding the others.
  for (let sweep = 0; sweep < 12; sweep++) {
    for (let ch = 0; ch < 3; ch++) {
      let lo = 0;
      let hi = 512;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const probe = x.slice();
        probe[ch] = mid;
        if (neutral(probe, exposure)[ch]! < t[ch]!) lo = mid;
        else hi = mid;
      }
      x[ch] = (lo + hi) / 2;
    }
  }
  return new THREE.Color(x[0], x[1], x[2]);
}
