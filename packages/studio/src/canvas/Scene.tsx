import { memo, type ReactNode } from "react";
import getStroke from "perfect-freehand";
import { shapeToPath, transformAttr, type DocT, type NodeT, type PaintT, type SketchStrokeT } from "@brusshy/core";
import { textToPath, useFontVersion } from "../lib/fonts";
import { liveNode, useStore } from "../lib/store";

/** A reference's project-relative path, never another host (`/evil.com/x.png` would become `//evil.com/x.png`). */
const sameOriginSrc = (src: string) => (/^[\w][\w./-]*$/.test(src) && !src.includes("..") && !src.includes("//") ? `/${src}` : "");

/** Renders the document's nodes as live SVG (the 2D source of truth on screen). */

const strokeCache = new Map<string, string>();

/** Variable-width outline of a freehand stroke. */
export function freehandPath(s: Pick<SketchStrokeT, "points" | "size">, last = true): string {
  const pts = s.points;
  const k = `${s.size}:${pts.length}:${pts[0]?.join(",")}:${pts[pts.length - 1]?.join(",")}:${last}`;
  const hit = strokeCache.get(k);
  if (hit) return hit;
  const outline = getStroke(pts, {
    size: s.size,
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: pts.every((p) => p[2] === 0.5),
    last,
  });
  let d = "";
  if (outline.length) {
    d = `M${outline[0]![0].toFixed(2)} ${outline[0]![1].toFixed(2)}Q`;
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i]!;
      const [x1, y1] = outline[(i + 1) % outline.length]!;
      d += `${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)} `;
    }
    d += "Z";
  }
  if (strokeCache.size > 4000) strokeCache.clear();
  if (last) strokeCache.set(k, d);
  return d;
}

function PaintDef({ id, paint }: { id: string; paint: PaintT }) {
  if (!paint || typeof paint === "string") return null;
  const stops = paint.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />);
  if (paint.type === "radial")
    return (
      <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
        {stops}
      </radialGradient>
    );
  const a = (paint.angle * Math.PI) / 180;
  const x = Math.cos(a) / 2;
  const y = Math.sin(a) / 2;
  return (
    <linearGradient id={id} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
      {stops}
    </linearGradient>
  );
}

const paintRef = (paint: PaintT, id: string) => (paint === null ? "none" : typeof paint === "string" ? paint : `url(#${id})`);

function styleProps(n: NodeT) {
  const s = n.style;
  const hasStroke = s.stroke !== null && s.strokeWidth > 0;
  return {
    fill: paintRef(s.fill, `f-${n.id}`),
    fillRule: s.fillRule,
    stroke: hasStroke ? paintRef(s.stroke, `s-${n.id}`) : undefined,
    strokeWidth: hasStroke ? s.strokeWidth : undefined,
    strokeLinecap: hasStroke ? s.strokeLinecap : undefined,
    strokeLinejoin: hasStroke ? s.strokeLinejoin : undefined,
    opacity: s.opacity !== 1 ? s.opacity : undefined,
  };
}

function Defs({ n }: { n: NodeT }) {
  const f = n.style.fill;
  const s = n.style.stroke;
  if ((!f || typeof f === "string") && (!s || typeof s === "string")) return null;
  return (
    <defs>
      <PaintDef id={`f-${n.id}`} paint={f} />
      <PaintDef id={`s-${n.id}`} paint={s} />
    </defs>
  );
}

/**
 * Layers the AI just added: a red-pencil outline traces the shape, then the
 * real artwork fades in under it (stagger = order of creation).
 */
function DrawIn({ fresh, d, transform, children }: { fresh: number | undefined; d: string; transform: string | undefined; children: ReactNode }) {
  if (fresh === undefined) return <>{children}</>;
  const delay = { animationDelay: `${Math.round(fresh * 700)}ms` };
  return (
    <>
      <g className="draw-in-fill" style={delay}>
        {children}
      </g>
      <path className="draw-in-line" style={delay} d={d} transform={transform} pathLength={1} fill="none" vectorEffect="non-scaling-stroke" />
    </>
  );
}

const NodeView = memo(function NodeView({ doc, id }: { doc: DocT; id: string }) {
  useStore((s) => s.live[id]);
  const fresh = useStore((s) => s.fresh[id]);
  useFontVersion((s) => s.v);
  const n = liveNode(doc, id);
  if (!n || !n.visible) return null;
  const common = { "data-id": n.id, transform: transformAttr(n.transform) };
  switch (n.type) {
    case "frame":
      return (
        <g transform={transformAttr(n.transform)} data-frame={n.id}>
          {/* transparent hit area: clicking the artboard background selects the version */}
          <rect data-id={n.id} className="frame-hit" width={n.width} height={n.height} fill="transparent" />
          {n.children.map((c) => (
            <NodeView key={c} doc={doc} id={c} />
          ))}
        </g>
      );
    case "group":
      return (
        <g {...common} opacity={n.style.opacity !== 1 ? n.style.opacity : undefined}>
          {n.children.map((c) => (
            <NodeView key={c} doc={doc} id={c} />
          ))}
        </g>
      );
    case "path":
    case "shape":
      return (
        <>
          <Defs n={n} />
          <DrawIn fresh={fresh} d={n.type === "path" ? n.d : shapeToPath(n)} transform={common.transform}>
            <path {...common} d={n.type === "path" ? n.d : shapeToPath(n)} {...styleProps(n)} />
          </DrawIn>
        </>
      );
    case "text": {
      const d = textToPath(n);
      return (
        <>
          <Defs n={n} />
          {d ? (
            <DrawIn fresh={fresh} d={d} transform={common.transform}>
              <path {...common} d={d} {...styleProps(n)} />
            </DrawIn>
          ) : (
            <text
              {...common}
              fontFamily={`"${n.fontFamily}", var(--font)`}
              fontSize={n.fontSize}
              fontWeight={n.fontWeight}
              letterSpacing={n.letterSpacing || undefined}
              textAnchor={n.anchor}
              {...styleProps(n)}
            >
              {n.text}
            </text>
          )}
        </>
      );
    }
    case "sketch":
      return (
        <g {...common} opacity={n.style.opacity} className="sketch-layer">
          {n.strokes.map((s, i) => (
            <path key={i} d={freehandPath(s)} fill={s.color} />
          ))}
        </g>
      );
    case "reference":
      return (
        <image
          {...common}
          href={n.src.startsWith("data:") ? n.src : sameOriginSrc(n.src)}
          width={n.width}
          height={n.height}
          opacity={n.style.opacity}
          preserveAspectRatio="none"
          style={{ imageRendering: "auto" }}
        />
      );
  }
});

export function SceneNodes({ doc }: { doc: DocT }) {
  return (
    <>
      {doc.root.map((id) => (
        <NodeView key={id} doc={doc} id={id} />
      ))}
    </>
  );
}
