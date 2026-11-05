import * as THREE from "three";
import { newId, normalizeColor, type DocT, type NodeT, type SceneT } from "@brusshy/core";
import { exclusive, prepare, renderFrame } from "../three/offscreen";
import type { LogoKit } from "./kit";

/**
 * 3D mockups: a derived document (the logo plus a card or a wall built from plain
 * shapes) rendered by the same offscreen engine as the 3D view.
 */

interface Built {
  doc: DocT;
  /** Nodes that should receive cast shadows (card/wall). */
  receivers: Set<string>;
  azimuth: number;
  elevation: number;
  /** Tilt the whole piece back (radians) to lie it on the table. */
  tilt: number;
  contactShadow: boolean;
  /** Render on transparent and lay it on this 2D backdrop with a soft cast shadow. */
  backdrop?: [string, string];
}

/** Wrap the logo's top-level layers in a group scaled to fit a box, every leaf extruded with `ex`. */
function withLogo(src: DocT, k: LogoKit, box: { x: number; y: number; w: number; h: number }, ex: (n: NodeT) => Record<string, unknown>, restyle?: (n: NodeT) => Partial<NodeT["style"]> | null) {
  const vb = k.full.vb;
  const s = Math.min(box.w / vb.width, box.h / vb.height);
  const gid = newId("n");
  const nodes: Record<string, NodeT> = {};
  const keep = src.root.filter((id) => {
    const n = src.nodes[id];
    return n && n.visible && n.type !== "sketch" && n.type !== "reference";
  });
  const visit = (id: string) => {
    const n = src.nodes[id];
    if (!n) return;
    const copy = { ...n } as NodeT;
    if (copy.parent === null) copy.parent = gid;
    if (copy.type !== "group" && copy.type !== "frame") {
      (copy as { extrude?: unknown }).extrude = ex(copy);
      const st = restyle?.(copy);
      if (st) copy.style = { ...copy.style, ...st };
    }
    nodes[id] = copy;
    if ("children" in n) n.children.forEach(visit);
  };
  keep.forEach(visit);
  nodes[gid] = {
    id: gid,
    type: "group",
    name: "logo",
    parent: null,
    visible: true,
    locked: false,
    aiLock: false,
    transform: {
      x: box.x + box.w / 2 - (vb.x + vb.width / 2) * s,
      y: box.y + box.h / 2 - (vb.y + vb.height / 2) * s,
      rotation: 0,
      scaleX: s,
      scaleY: s,
    },
    style: { fill: null, stroke: null, strokeWidth: 0, strokeLinecap: "round", strokeLinejoin: "round", opacity: 1, fillRule: "nonzero" },
    children: keep,
  } as NodeT;
  return { gid, nodes };
}

function slab(id: string, name: string, w: number, h: number, color: string, extrude: Record<string, unknown>, radius = 0): NodeT {
  return {
    id,
    type: "shape",
    shape: "rect",
    name,
    parent: null,
    visible: true,
    locked: false,
    aiLock: false,
    width: w,
    height: h,
    radius,
    sides: 4,
    innerRatio: 0.5,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    style: { fill: color, stroke: null, strokeWidth: 0, strokeLinecap: "round", strokeLinejoin: "round", opacity: 1, fillRule: "nonzero" },
    extrude: { depth: 10, bevel: 2, bevelSegments: 4, material: "stone", materialOverrides: {}, z: 0, ...extrude },
  } as NodeT;
}

const scene = (src: DocT, patch: Partial<SceneT>): SceneT => ({ ...src.scene, ...patch, camera: { ...src.scene.camera, ...(patch.camera ?? {}) } });

function foilCard(src: DocT, k: LogoKit): Built {
  const W = 1050;
  const H = 600;
  const dark = k.dark || k.lum > 0.6;
  const paper = dark ? "#16171a" : "#ece6da";
  const cardId = newId("n");
  const T = 16;
  // One-color foil: parts in the dominant color are foiled; other parts are knocked out to
  // bare card (a hair higher so they read as cut-outs in the foil).
  const ink = (n: NodeT) => {
    const d = k.colors[0];
    const fill = typeof n.style.fill === "string" ? n.style.fill : typeof n.style.stroke === "string" ? n.style.stroke : null;
    if (!d || !fill) return true;
    const c = /^#([0-9a-f]{6})$/i.exec(fill.trim());
    if (!c) return true;
    const v = parseInt(c[1]!, 16);
    return Math.hypot(((v >> 16) & 255) - d.r, ((v >> 8) & 255) - d.g, (v & 255) - d.b) < 70;
  };
  const { gid, nodes } = withLogo(
    src,
    k,
    { x: W * 0.22, y: H * 0.24, w: W * 0.56, h: H * 0.52 },
    (n) =>
      ink(n)
        ? { depth: 1.6, bevel: 0.5, bevelSegments: 3, material: "gold", materialOverrides: {}, z: T }
        : { depth: 1.9, bevel: 0.3, bevelSegments: 2, material: "stone", materialOverrides: {}, z: T },
    (n) => (ink(n) ? null : { fill: paper, stroke: n.style.stroke ? paper : null }),
  );
  nodes[cardId] = slab(cardId, "card", W, H, paper, { depth: T, bevel: 3, material: "stone" }, 14);
  return {
    doc: {
      ...src,
      artboard: { width: W, height: H, background: null },
      root: [cardId, gid],
      nodes,
      annotations: {},
      scene: scene(src, {
        lighting: "studio",
        environment: "room",
        background: dark ? "#0f1012" : "#d9d3c9",
        shadow: true,
        bloom: 0,
        material: "gold",
        camera: { azimuth: -14, elevation: 52, fov: 28, distance: 1.3 },
      }),
    },
    receivers: new Set([cardId]),
    azimuth: -14,
    elevation: 52,
    tilt: -Math.PI / 2 + 0.0001,
    contactShadow: false,
    backdrop: dark ? ["#24252a", "#0d0e10"] : ["#ebe7e0", "#cbc4b8"],
  };
}

function wallSign(src: DocT, k: LogoKit): Built {
  const W = 4200;
  const H = 2600;
  const dark = k.dark;
  const wall = dark ? "#2b2d31" : "#dcd8d1";
  const wallId = newId("n");
  const metal = !k.colorful;
  // A plate (the badge under the mark) is a painted panel in its own color, so the metal mark on
  // it keeps its contrast; one metal for both would melt the mark into the plate.
  const plate = (n: NodeT) => {
    const fill = typeof n.style.fill === "string" ? normalizeColor(n.style.fill) : null;
    return !!fill && k.plates.has(fill);
  };
  const { gid, nodes } = withLogo(src, k, { x: W * 0.36, y: H * 0.34, w: W * 0.28, h: H * 0.3 }, (n) =>
    plate(n)
      ? { depth: 22, bevel: 2, bevelSegments: 4, material: "glossy-enamel", materialOverrides: {}, z: 12 + 14 }
      : {
          depth: 34,
          bevel: 2.5,
          bevelSegments: 4,
          material: metal ? (dark ? "gold" : "brushed-metal") : "glossy-enamel",
          materialOverrides: {},
          z: 12 + 26,
        },
  );
  nodes[wallId] = slab(wallId, "wall", W, H, wall, { depth: 12, bevel: 0, material: "stone" });
  return {
    doc: {
      ...src,
      artboard: { width: W, height: H, background: null },
      root: [wallId, gid],
      nodes,
      annotations: {},
      scene: scene(src, {
        // Metal mirrors its surroundings: under dramatic light in a dark room it turns as dark as
        // the wall. Studio light keeps the letters bright against a dark wall.
        lighting: "studio",
        environment: "room",
        background: wall,
        shadow: true,
        bloom: 0,
        camera: { azimuth: -30, elevation: 6, fov: 30, distance: 0.42 },
      }),
    },
    receivers: new Set([wallId]),
    azimuth: -30,
    elevation: 6,
    tilt: 0,
    contactShadow: false,
  };
}

/** Render a 3D mockup to a canvas of width × height. */
export async function render3DMockup(kind: "foil-card" | "wall-sign", src: DocT, k: LogoKit, width: number, height: number): Promise<HTMLCanvasElement> {
  const b = kind === "foil-card" ? foilCard(src, k) : wallSign(src, k);
  return exclusive(async () => {
    const { stage } = await prepare(b.doc);
    const meshes: THREE.Mesh[] = [];
    stage.logoRoot.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    for (const m of meshes) m.receiveShadow = b.receivers.has(m.userData.nodeId as string);
    const contact = stage.shadow.visible;
    stage.shadow.visible = b.contactShadow;
    stage.setPose(0, 0, b.tilt);
    try {
      const frame = renderFrame({ width, height, transparent: !!b.backdrop, azimuth: b.azimuth, elevation: b.elevation });
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d")!;
      if (b.backdrop) {
        const bg = ctx.createRadialGradient(width * 0.4, height * 0.25, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.8);
        bg.addColorStop(0, b.backdrop[0]);
        bg.addColorStop(1, b.backdrop[1]);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
        // Cast shadow from the render's own silhouette: a wide soft one and a tight contact one.
        const u = width / 1600;
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${k.dark ? 0.55 : 0.22})`;
        ctx.shadowBlur = 60 * u;
        ctx.shadowOffsetY = 34 * u;
        ctx.drawImage(frame, 0, 0);
        ctx.shadowColor = `rgba(0,0,0,${k.dark ? 0.5 : 0.18})`;
        ctx.shadowBlur = 6 * u;
        ctx.shadowOffsetY = 3 * u;
        ctx.drawImage(frame, 0, 0);
        ctx.restore();
      }
      ctx.drawImage(frame, 0, 0);
      // Photographic finish: gentle vignette.
      const g = ctx.createRadialGradient(width * 0.5, height * 0.45, Math.min(width, height) * 0.25, width * 0.5, height * 0.5, Math.max(width, height) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${k.dark ? 0.35 : 0.14})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      return out;
    } finally {
      for (const m of meshes) m.receiveShadow = false;
      stage.shadow.visible = contact;
      stage.setPose(0, 0, 0);
    }
  });
}
