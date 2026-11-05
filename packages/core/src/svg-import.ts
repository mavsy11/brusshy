import { XMLParser } from "fast-xml-parser";
import { IDENTITY, multiply, type Mat } from "./geometry";
import { newId } from "./ids";
import type { OpT } from "./ops";
import type { GradientT, PaintT, TransformT } from "./schema";

type El = { tag: string; attrs: Record<string, string>; children: El[]; text: string };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
});

function toEls(raw: unknown[]): El[] {
  const out: El[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const tag = Object.keys(item).find((k) => k !== ":@");
    if (!tag || tag === "#text" || tag.startsWith("?") || tag === "#comment") continue;
    const kids = (item[tag] as unknown[]) ?? [];
    const text = (kids as Record<string, unknown>[])
      .filter((k) => "#text" in k)
      .map((k) => String(k["#text"]))
      .join("");
    out.push({
      tag: tag.replace(/^svg:/, ""),
      attrs: (item[":@"] as Record<string, string>) ?? {},
      children: toEls(kids),
      text,
    });
  }
  return out;
}

const num = (v: string | undefined, d = 0) => {
  if (v === undefined) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/** Parse an SVG transform list into a matrix. */
export function parseTransform(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s))) {
    const v = match[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = IDENTITY;
    switch (match[1]) {
      case "matrix":
        t = [v[0] ?? 1, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1, v[4] ?? 0, v[5] ?? 0];
        break;
      case "translate":
        t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case "scale":
        t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const r: Mat = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        const cx = v[1] ?? 0;
        const cy = v[2] ?? 0;
        t = multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Decompose a matrix into translate/rotate/scale (skew is dropped). */
export function decompose(m: Mat): TransformT {
  const scaleX = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r(m[4]), y: r(m[5]), rotation: r(rotation), scaleX: r(scaleX), scaleY: r(scaleX ? det / scaleX : 1) };
}

function styleMap(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "fill-rule", "font-family", "font-size", "font-weight", "letter-spacing", "text-anchor"]) {
    if (el.attrs[k] !== undefined) out[k] = el.attrs[k]!;
  }
  for (const decl of (el.attrs.style ?? "").split(";")) {
    const [k, v] = decl.split(":").map((x) => x?.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

function parseGradients(root: El): Map<string, GradientT> {
  const out = new Map<string, GradientT>();
  const visit = (el: El) => {
    if ((el.tag === "linearGradient" || el.tag === "radialGradient") && el.attrs.id) {
      const stops = el.children
        .filter((c) => c.tag === "stop")
        .map((s) => {
          const sm = styleMap(s);
          const off = s.attrs.offset ?? "0";
          return {
            offset: Math.min(1, Math.max(0, off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off))),
            color: s.attrs["stop-color"] ?? sm["stop-color"] ?? "#000",
          };
        });
      if (stops.length >= 2) {
        const angle =
          el.tag === "linearGradient"
            ? (Math.atan2(num(el.attrs.y2, 0) - num(el.attrs.y1, 0), num(el.attrs.x2, 1) - num(el.attrs.x1, 0)) * 180) / Math.PI
            : 0;
        out.set(el.attrs.id, { type: el.tag === "linearGradient" ? "linear" : "radial", angle: Math.round(angle), stops });
      }
    }
    el.children.forEach(visit);
  };
  visit(root);
  return out;
}

export interface ImportOptions {
  parent?: string | null;
  /** Insert position for the first top-level node in its parent. */
  index?: number;
  /** Wrap all imported nodes in one group with this name. */
  groupName?: string;
}

/**
 * Convert an SVG string or fragment into `add` ops. Coordinates are kept as-is
 * (they are artboard units). Returns the ops and the ids of the top-level nodes.
 */
export function svgToOps(svg: string, opts: ImportOptions = {}): { ops: OpT[]; ids: string[] } {
  const src = /<svg[\s>]/i.test(svg) ? svg : `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  const els = toEls(parser.parse(src) as unknown[]);
  const root = els.find((e) => e.tag === "svg");
  if (!root) throw new Error("No <svg> element found");
  const gradients = parseGradients(root);
  const ops: OpT[] = [];
  const topIds: string[] = [];

  const paint = (v: string | undefined, inherited: PaintT): PaintT => {
    if (v === undefined || v === "inherit") return inherited;
    if (v === "none" || v === "transparent") return null;
    if (v === "currentColor") return "#0b0c0e";
    const m = /url\(#([^)]+)\)/.exec(v);
    if (m) return gradients.get(m[1]!) ?? inherited;
    return v;
  };

  type Inh = { fill: PaintT; stroke: PaintT; strokeWidth: number; s: Record<string, string> };

  const visit = (el: El, parent: string | null, parentMatrix: Mat, inh: Inh, top: boolean) => {
    if (["defs", "title", "desc", "metadata", "style", "linearGradient", "radialGradient", "clipPath", "mask"].includes(el.tag)) return;
    const sm = { ...inh.s, ...styleMap(el) };
    const own = parseTransform(el.attrs.transform);
    const fill = paint(styleMap(el).fill, inh.fill);
    const stroke = paint(styleMap(el).stroke, inh.stroke);
    const strokeWidth = sm["stroke-width"] !== undefined ? num(sm["stroke-width"], 1) : inh.strokeWidth;
    const opacity = num(styleMap(el).opacity, 1) * num(styleMap(el)["fill-opacity"], 1);
    const style = {
      fill,
      stroke,
      strokeWidth: stroke ? strokeWidth : 0,
      strokeLinecap: (sm["stroke-linecap"] as "round") ?? "round",
      strokeLinejoin: (sm["stroke-linejoin"] as "round") ?? "round",
      opacity,
      fillRule: (sm["fill-rule"] as "nonzero") ?? "nonzero",
    };
    const name = el.attrs.id ?? el.attrs["data-name"] ?? "";
    const push = (node: Record<string, unknown>, local: Mat = IDENTITY) => {
      const id = newId("n");
      ops.push({ op: "add", node: { id, name, ...node, transform: decompose(multiply(own, local)) }, parent, index: top && opts.index !== undefined ? opts.index + topIds.length : undefined });
      if (top) topIds.push(id);
      return id;
    };

    switch (el.tag) {
      case "svg":
      case "g":
      case "a": {
        if (el.tag === "svg" && el === root) {
          el.children.forEach((c) => visit(c, parent, parentMatrix, { fill, stroke, strokeWidth, s: sm }, top));
          return;
        }
        const id = push({ type: "group", style: { ...style, fill: null } });
        el.children.forEach((c) => visit(c, id, own, { fill, stroke, strokeWidth, s: sm }, false));
        return;
      }
      case "path":
        if (el.attrs.d) push({ type: "path", d: el.attrs.d, style });
        return;
      case "rect": {
        const w = num(el.attrs.width);
        const h = num(el.attrs.height);
        if (w <= 0 || h <= 0) return;
        push({ type: "shape", shape: "rect", width: w, height: h, radius: num(el.attrs.rx ?? el.attrs.ry), style }, [1, 0, 0, 1, num(el.attrs.x), num(el.attrs.y)]);
        return;
      }
      case "circle":
      case "ellipse": {
        const rx = el.tag === "circle" ? num(el.attrs.r) : num(el.attrs.rx);
        const ry = el.tag === "circle" ? num(el.attrs.r) : num(el.attrs.ry);
        if (rx <= 0 || ry <= 0) return;
        push({ type: "shape", shape: "ellipse", width: rx * 2, height: ry * 2, style }, [1, 0, 0, 1, num(el.attrs.cx) - rx, num(el.attrs.cy) - ry]);
        return;
      }
      case "polygon":
      case "polyline": {
        const nums = (el.attrs.points ?? "").trim().split(/[\s,]+/).map(Number);
        if (nums.length < 4) return;
        let d = "";
        for (let i = 0; i + 1 < nums.length; i += 2) d += `${i === 0 ? "M" : "L"}${nums[i]} ${nums[i + 1]}`;
        if (el.tag === "polygon") d += "Z";
        push({ type: "path", d, style: el.tag === "polyline" && !styleMap(el).fill ? { ...style, fill: null } : style });
        return;
      }
      case "line": {
        const d = `M${num(el.attrs.x1)} ${num(el.attrs.y1)}L${num(el.attrs.x2)} ${num(el.attrs.y2)}`;
        push({ type: "path", d, style: { ...style, fill: null } });
        return;
      }
      case "text": {
        const text = (el.text + el.children.map((c) => c.text).join("")).trim();
        if (!text) return;
        push(
          {
            type: "text",
            text,
            fontFamily: (sm["font-family"] ?? "Geist").split(",")[0]!.replace(/['"]/g, "").trim(),
            fontSize: num(sm["font-size"], 64),
            fontWeight: sm["font-weight"] === "bold" ? 700 : Math.round(num(sm["font-weight"], 600) / 100) * 100 || 600,
            letterSpacing: num(sm["letter-spacing"], 0),
            anchor: (sm["text-anchor"] as "start") ?? "start",
            style,
          },
          [1, 0, 0, 1, num(el.attrs.x), num(el.attrs.y)],
        );
        return;
      }
    }
  };

  const inh: Inh = { fill: "#0b0c0e", stroke: null, strokeWidth: 1, s: {} };
  if (opts.groupName) {
    const gid = newId("n");
    ops.push({ op: "add", node: { id: gid, type: "group", name: opts.groupName, style: { fill: null } }, parent: opts.parent ?? null, index: opts.index });
    topIds.push(gid);
    const before = topIds.length;
    visit(root, gid, IDENTITY, inh, false);
    topIds.length = before;
  } else {
    visit(root, opts.parent ?? null, IDENTITY, inh, true);
  }
  return { ops, ids: topIds };
}
