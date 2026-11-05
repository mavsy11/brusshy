import { continueWithVariantOps, findFrame, listFrames, variantsOf, type NodeT } from "@brusshy/core";
import { activeFrameId, dispatch, redo, select, setActiveFrame, setTool, setView, toast, toggleRulers, undo, useStore, type Tool } from "../lib/store";
import {
  addReferenceImage,
  alignSelection,
  convertToPath,
  copySelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  groupSelection,
  pasteInternal,
  reorder,
  selectAllInFrame,
  topSelection,
  ungroupSelection,
  type Align,
} from "../lib/actions";
import { cornerSelectedNodes, selectAllNodes, smoothSelectedNodes } from "../lib/nodeTools";
import { copyAsPng, copyAsSvg, toggleOutlines, useQuick } from "../lib/quick";
import { copyNotes } from "../lib/notes";
import { makeLettering } from "../lib/lettering";
import { fitCamera, fitFrame, zoomTo } from "../canvas/camera";
import { contentBox, selectionBox } from "../lib/geom";
import { socket } from "../lib/socket";
import { openMockups } from "../mockups/MockupsDialog";
import { openFonts } from "../typeset/state";
import { openPalette } from "../palette/state";
import { openVectorize } from "../vectorize/run";
import { player } from "../animation/player";
import { Icons, NODE_ICON } from "../panels/icons";
import { QIcons } from "../panels/quickIcons";
import { t } from "../lib/i18n";
import { registerCommands, registerProvider, type Command } from "./registry";
import { revealSection, showSideTab } from "./reveal";
import { CmdIcons } from "./icons";

/** Built-in commands: every tool and studio action, plus versions, layers, documents and history. */

const S = () => useStore.getState();
const doc = () => S().doc;
const sel = () => {
  const d = doc();
  return d ? topSelection(d, S().selection) : [];
};
const layers = () => {
  const d = doc();
  return d ? sel().filter((id) => d.nodes[id]?.type !== "frame") : [];
};
const hasSel = () => sel().length > 0;
const hasLayers = () => layers().length > 0;
const single = (): NodeT | null => {
  const ids = layers();
  return ids.length === 1 ? doc()!.nodes[ids[0]!]! : null;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const selHint = () => {
  const ids = sel();
  if (!ids.length) return undefined;
  const d = doc()!;
  if (ids.length === 1) {
    const n = d.nodes[ids[0]!]!;
    return n.type === "frame" ? `version ${n.name}` : nodeLabel(n);
  }
  return plural(ids.length, "layer");
};
const versionHint = () => {
  const d = doc();
  const id = d ? activeFrameId(d) : null;
  return id ? d!.nodes[id]!.name : undefined;
};
const frameNode = () => {
  const d = doc();
  const id = d ? activeFrameId(d) : null;
  return id ? (d!.nodes[id] as Extract<NodeT, { type: "frame" }>) : null;
};
const isGeometric = (n: NodeT | null) => !!n && (n.type === "path" || n.type === "shape" || n.type === "text" || n.type === "group");

export function nodeLabel(n: NodeT): string {
  return n.name || (n.type === "text" ? `“${n.text}”` : n.type === "shape" ? n.shape : n.type);
}

function pickImage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void addReferenceImage(f);
  };
  input.click();
}

/** Select the active version so its panels (lockup, animation…) show, then scroll to one. */
function revealVersionSection(title: string) {
  const f = frameNode();
  if (f) select([f.id]);
  revealSection(title);
}

function focusChat(text?: string) {
  const ta = document.querySelector<HTMLTextAreaElement>(".chat-dock textarea");
  if (!ta) return toast("The canvas chat isn't available");
  if (text !== undefined) {
    // Fill React's controlled textarea through the native setter so its state updates.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ta.focus();
}

/** Send a request to the canvas chat (same message the chat dock sends). */
export function askAi(text: string) {
  const s = S();
  const d = s.doc;
  if (!d || !text.trim()) return;
  if (s.chat?.busy) return toast("Your AI is still working — try again when it's done");
  socket.send({ t: "chat", text: text.trim(), frame: s.activeFrame ?? activeFrameId(d), selection: layers() });
  toast("Sent to your AI", "agent");
}

const TOOLS: { id: Tool; key: string; icon: keyof typeof Icons; keywords: string[] }[] = [
  { id: "select", key: "V", icon: "select", keywords: ["move", "pointer", "arrow"] },
  { id: "node", key: "A", icon: "node", keywords: ["direct", "bezier", "points", "anchors", "edit path"] },
  { id: "hand", key: "H", icon: "hand", keywords: ["pan", "scroll"] },
  { id: "brush", key: "B", icon: "brush", keywords: ["sketch", "draw", "pencil", "freehand"] },
  { id: "rect", key: "R", icon: "rect", keywords: ["rectangle", "square", "box"] },
  { id: "ellipse", key: "O", icon: "ellipse", keywords: ["circle", "oval"] },
  { id: "polygon", key: "P", icon: "polygon", keywords: ["triangle", "hexagon", "sides"] },
  { id: "star", key: "S", icon: "star", keywords: ["burst"] },
  { id: "text", key: "T", icon: "text", keywords: ["type", "word", "font", "wordmark"] },
  { id: "comment", key: "C", icon: "comment", keywords: ["note", "annotation", "pin", "feedback"] },
];

const ALIGN: { a: Align; title: string; icon: keyof typeof Icons }[] = [
  { a: "left", title: "Align left", icon: "alignLeft" },
  { a: "hcenter", title: "Align center", icon: "alignHCenter" },
  { a: "right", title: "Align right", icon: "alignRight" },
  { a: "top", title: "Align top", icon: "alignTop" },
  { a: "vcenter", title: "Align middle", icon: "alignVCenter" },
  { a: "bottom", title: "Align bottom", icon: "alignBottom" },
];

const statics: Command[] = [
  // ── Tools
  ...TOOLS.map(
    (x): Command => ({
      id: `tool.${x.id}`,
      title: t(`tool.${x.id}`),
      group: "Tools",
      keywords: ["tool", ...x.keywords],
      shortcut: x.key,
      icon: Icons[x.icon],
      hint: () => (S().tool === x.id ? "current" : undefined),
      run: () => {
        if (x.id === "node") {
          const n = single();
          if (n && (n.type === "path" || n.type === "shape") && convertToPath(n.id)) useStore.setState({ editingId: n.id });
        }
        setTool(x.id);
      },
    }),
  ),
  { id: "tool.image", title: "Add reference image…", group: "Tools", keywords: ["trace", "photo", "upload", "picture"], icon: Icons.image, run: pickImage },

  // ── Edit
  { id: "edit.undo", title: "Undo", group: "Edit", shortcut: "⌘Z", icon: Icons.undo, when: () => S().canUndo, hint: () => S().timeline.items[S().timeline.cursor - 1]?.label, run: undo },
  { id: "edit.redo", title: "Redo", group: "Edit", shortcut: "⇧⌘Z", icon: Icons.redo, when: () => S().canRedo, hint: () => S().timeline.items[S().timeline.cursor]?.label, run: redo },
  { id: "edit.duplicate", title: "Duplicate", group: "Edit", shortcut: "⌘D", keywords: ["copy", "clone", "new version"], icon: Icons.copy, when: hasSel, hint: selHint, run: () => duplicateSelection() },
  { id: "edit.delete", title: "Delete", group: "Edit", shortcut: "⌫", keywords: ["remove", "erase"], icon: Icons.trash, when: hasSel, hint: selHint, run: deleteSelection },
  { id: "edit.group", title: "Group", group: "Edit", shortcut: "⌘G", icon: Icons.group, when: hasLayers, hint: selHint, run: groupSelection },
  { id: "edit.ungroup", title: "Ungroup", group: "Edit", shortcut: "⇧⌘G", icon: Icons.group, when: () => layers().some((id) => doc()!.nodes[id]?.type === "group"), hint: selHint, run: ungroupSelection },
  { id: "edit.selectAll", title: "Select all", group: "Edit", shortcut: "⌘A", keywords: ["everything"], icon: Icons.select, hint: versionHint, run: selectAllInFrame },
  { id: "edit.deselect", title: "Deselect", group: "Edit", shortcut: "Esc", icon: Icons.select, when: hasSel, run: () => select([]) },
  { id: "edit.copy", title: "Copy", group: "Edit", shortcut: "⌘C", icon: Icons.copy, when: hasSel, hint: selHint, run: copySelection },
  { id: "edit.cut", title: "Cut", group: "Edit", shortcut: "⌘X", icon: Icons.copy, when: hasSel, hint: selHint, run: () => (copySelection(), deleteSelection()) },
  { id: "edit.paste", title: "Paste", group: "Edit", shortcut: "⌘V", icon: Icons.copy, run: () => pasteInternal() || toast("Nothing copied yet — or press ⌘V on the canvas to paste an image or SVG") },
  { id: "edit.copySvg", title: "Copy as SVG", group: "Edit", shortcut: "⇧⌘C", keywords: ["export", "code", "clipboard"], icon: QIcons.copySvg, hint: () => selHint() ?? versionHint(), run: copyAsSvg },
  { id: "edit.copyPng", title: "Copy as PNG", group: "Edit", shortcut: "⌥⇧⌘C", keywords: ["image", "clipboard", "raster"], icon: QIcons.image, hint: () => selHint() ?? versionHint(), run: copyAsPng },
  { id: "edit.forward", title: "Bring forward", group: "Edit", shortcut: "⌘]", keywords: ["order", "arrange", "raise"], icon: CmdIcons.forward, when: hasLayers, run: () => reorder("up") },
  { id: "edit.backward", title: "Send backward", group: "Edit", shortcut: "⌘[", keywords: ["order", "arrange", "lower"], icon: CmdIcons.backward, when: hasLayers, run: () => reorder("down") },
  { id: "edit.front", title: "Bring to front", group: "Edit", shortcut: "⌥⌘]", keywords: ["order", "arrange", "top"], icon: CmdIcons.forward, when: hasLayers, run: () => reorder("top") },
  { id: "edit.back", title: "Send to back", group: "Edit", shortcut: "⌥⌘[", keywords: ["order", "arrange", "bottom"], icon: CmdIcons.backward, when: hasLayers, run: () => reorder("bottom") },
  { id: "edit.flipH", title: "Flip horizontal", group: "Edit", keywords: ["mirror", "reflect"], icon: Icons.flipH, when: hasLayers, hint: selHint, run: () => flipSelection("x") },
  { id: "edit.flipV", title: "Flip vertical", group: "Edit", keywords: ["mirror", "reflect", "upside down"], icon: Icons.flipV, when: hasLayers, hint: selHint, run: () => flipSelection("y") },
  ...ALIGN.map(
    (x): Command => ({
      id: `edit.align.${x.a}`,
      title: x.title,
      group: "Edit",
      keywords: ["align", "arrange", "center"],
      icon: Icons[x.icon],
      when: hasLayers,
      hint: () => (layers().length === 1 ? "to the artboard" : "to the selection"),
      run: () => alignSelection(x.a),
    }),
  ),
  {
    id: "edit.toPath",
    title: "Convert to path",
    group: "Edit",
    keywords: ["outline", "outlines", "expand", "vector"],
    icon: Icons.path,
    when: () => {
      const n = single();
      return !!n && (n.type === "shape" || n.type === "text");
    },
    hint: selHint,
    run: () => convertToPath(single()!.id),
  },
  {
    id: "edit.lettering",
    title: "Split into letters",
    group: "Edit",
    keywords: ["lettering", "letters", "glyphs", "custom type", "wordmark"],
    icon: Icons.text,
    when: () => single()?.type === "text",
    hint: selHint,
    run: () => makeLettering(single()!.id),
  },
  {
    id: "edit.hide",
    title: "Hide / show layer",
    group: "Edit",
    keywords: ["visibility", "visible", "eye"],
    icon: Icons.eye,
    when: hasLayers,
    hint: selHint,
    run: () => {
      const d = doc()!;
      const ids = layers();
      const show = ids.every((id) => !d.nodes[id]!.visible);
      dispatch(ids.map((id) => ({ op: "update", id, set: { visible: show } })), show ? "Show" : "Hide");
    },
  },
  {
    id: "edit.lock",
    title: "Lock / unlock layer",
    group: "Edit",
    keywords: ["protect", "freeze"],
    icon: Icons.lock,
    when: hasLayers,
    hint: selHint,
    run: () => {
      const d = doc()!;
      const ids = layers();
      const lock = ids.some((id) => !d.nodes[id]!.locked);
      dispatch(ids.map((id) => ({ op: "update", id, set: { locked: lock } })), lock ? "Lock" : "Unlock");
      if (lock) select([]);
    },
  },
  {
    id: "edit.aiLock",
    title: "Lock / unlock for the AI",
    group: "Edit",
    keywords: ["protect", "keep", "ai lock", "don't touch"],
    icon: QIcons.aiLock,
    when: hasSel,
    hint: () => {
      const d = doc();
      const ids = sel();
      return d && ids.length ? (ids.every((id) => d.nodes[id]!.aiLock) ? "locked — unlock" : "your AI won't change it") : undefined;
    },
    run: () => {
      const d = doc()!;
      const ids = sel();
      const lock = !ids.every((id) => d.nodes[id]!.aiLock);
      dispatch(ids.map((id) => ({ op: "update", id, set: { aiLock: lock } })), lock ? "AI lock" : "AI unlock");
    },
  },

  // ── Node editing
  { id: "nodes.smooth", title: "Smooth nodes", group: "Edit", keywords: ["node", "bezier", "curve"], icon: Icons.node, when: () => S().tool === "node" && !!S().editingId, hint: () => (S().nodeSel.length ? plural(S().nodeSel.length, "node") : "all nodes"), run: smoothSelectedNodes },
  { id: "nodes.corner", title: "Corner nodes", group: "Edit", keywords: ["node", "sharp", "cusp"], icon: Icons.node, when: () => S().tool === "node" && !!S().editingId, hint: () => (S().nodeSel.length ? plural(S().nodeSel.length, "node") : "all nodes"), run: cornerSelectedNodes },
  { id: "nodes.all", title: "Select all nodes", group: "Edit", shortcut: "⌘A", keywords: ["node", "anchors"], icon: Icons.node, when: () => S().tool === "node" && !!S().editingId, run: selectAllNodes },

  // ── View
  { id: "view.2d", title: "2D view", group: "View", shortcut: "2", keywords: ["flat", "canvas", "mode"], icon: Icons.square2d, hint: () => (S().view === "2d" ? "current" : undefined), run: () => setView("2d") },
  { id: "view.3d", title: "3D view", group: "View", shortcut: "3", keywords: ["render", "extrude", "mode"], icon: Icons.cube, hint: () => (S().view === "3d" ? "current" : undefined), run: () => setView("3d") },
  { id: "view.split", title: "Split view", group: "View", shortcut: "4", keywords: ["side by side", "2d 3d", "mode"], icon: Icons.split, hint: () => (S().view === "split" ? "current" : undefined), run: () => setView("split") },
  { id: "view.outlines", title: "Outlines", group: "View", shortcut: "⌘Y", keywords: ["wireframe", "keyline", "paths"], icon: QIcons.outlines, hint: () => (useQuick.getState().outlines ? "on" : "off"), run: () => toggleOutlines() },
  { id: "view.rulers", title: "Rulers", group: "View", shortcut: "⇧R", keywords: ["guides", "measure"], icon: CmdIcons.ruler, hint: () => (S().showRulers ? "on" : "off"), run: toggleRulers },
  { id: "view.notes", title: "Show / hide notes", group: "View", shortcut: "N", keywords: ["annotations", "pins", "comments"], icon: Icons.comment, hint: () => (S().showAnnotations ? "shown" : "hidden"), run: () => useStore.setState({ showAnnotations: !S().showAnnotations }) },
  { id: "view.fitAll", title: "Zoom to fit all versions", group: "View", shortcut: "⌘0", keywords: ["zoom", "fit", "overview"], icon: Icons.fit, run: () => doc() && useStore.setState({ camera: fitCamera(doc()!) }) },
  {
    id: "view.fitVersion",
    title: "Zoom to the active version",
    group: "View",
    shortcut: "⇧2",
    keywords: ["zoom", "fit", "frame", "artboard"],
    icon: Icons.fit,
    hint: versionHint,
    run: () => {
      const id = activeFrameId();
      if (id) useStore.setState({ camera: fitFrame(doc()!, id) });
    },
  },
  {
    id: "view.fitSelection",
    title: "Zoom to selection",
    group: "View",
    shortcut: "⌘2",
    keywords: ["zoom", "focus"],
    icon: Icons.fit,
    hint: () => selHint() ?? "everything",
    run: () => {
      const d = doc()!;
      const b = S().selection.length ? selectionBox(d, S().selection) : contentBox(d);
      if (b) useStore.setState({ camera: fitCamera(d, b, 80) });
    },
  },
  { id: "view.zoom100", title: "Zoom to 100%", group: "View", shortcut: "⌘1", keywords: ["actual size", "zoom"], icon: CmdIcons.zoomIn, run: () => zoomTo(1) },
  { id: "view.zoomIn", title: "Zoom in", group: "View", shortcut: "⌘+", icon: CmdIcons.zoomIn, run: () => zoomTo(S().camera.zoom * 1.25) },
  { id: "view.zoomOut", title: "Zoom out", group: "View", shortcut: "⌘−", icon: CmdIcons.zoomOut, run: () => zoomTo(S().camera.zoom / 1.25) },

  // ── Panels & dialogs
  { id: "panel.export", title: "Export…", group: "Panels", shortcut: "E", keywords: ["download", "svg", "png", "favicon", "brand kit", "pdf", "glb", "video"], icon: Icons.export, hint: versionHint, run: () => useStore.setState({ exportOpen: true }) },
  { id: "panel.mockups", title: "Mockups…", group: "Panels", keywords: ["preview", "card", "sign", "merch", "app icon", "in use"], icon: CmdIcons.mockup, hint: versionHint, run: openMockups },
  { id: "panel.fonts", title: "Fonts…", group: "Panels", keywords: ["type", "typography", "pairing", "heading", "body", "google fonts"], icon: CmdIcons.fonts, run: () => openFonts(single()?.type === "text" ? "selection" : "heading") },
  { id: "panel.brief", title: "Brief…", group: "Panels", keywords: ["brand", "goals", "audience", "context"], icon: QIcons.brief, run: () => useQuick.setState({ briefOpen: true }) },
  { id: "panel.palette", title: "Palette…", group: "Panels", keywords: ["colors", "colours", "brand", "harmony", "generate"], icon: CmdIcons.palette, run: () => openPalette("palette") },
  { id: "panel.colorways", title: "Colorways…", group: "Panels", keywords: ["colors", "combinations", "contrast", "palette"], icon: CmdIcons.palette, hint: versionHint, run: () => openPalette("colorways") },
  { id: "panel.small", title: "Small sizes…", group: "Panels", keywords: ["favicon", "16px", "pixels", "legibility", "check"], icon: QIcons.pixels, hint: versionHint, run: () => useQuick.setState({ smallOpen: true }) },
  { id: "panel.help", title: "Shortcuts & AI setup", group: "Panels", shortcut: "?", keywords: ["help", "keyboard", "keys", "connect", "mcp"], icon: Icons.help, run: () => useStore.setState({ helpOpen: true }) },
  { id: "panel.lockup", title: "Lockup", group: "Panels", keywords: ["horizontal", "stacked", "wordmark", "mark", "clear space"], icon: CmdIcons.lockup, hint: versionHint, run: () => revealVersionSection("Lockup") },
  { id: "panel.animation", title: "Animation", group: "Panels", keywords: ["motion", "entrance", "loop", "animate", "gif", "video"], icon: CmdIcons.play, hint: versionHint, run: () => revealVersionSection("Animation") },
  { id: "panel.style", title: "Style series", group: "Panels", keywords: ["profile", "match", "icon set", "consistency"], icon: Icons.sparkle, hint: versionHint, run: () => revealVersionSection("Style") },
  { id: "panel.warp", title: "Warp", group: "Panels", keywords: ["arch", "bulge", "flag", "envelope", "distort", "type lab"], icon: CmdIcons.warp, when: () => isGeometric(single()) || layers().length > 1, hint: selHint, run: () => revealSection("Warp") },
  { id: "panel.effects", title: "Effects", group: "Panels", keywords: ["outline", "inline", "shadow", "double", "type lab"], icon: CmdIcons.effects, when: () => isGeometric(single()) || layers().length > 1, hint: selHint, run: () => revealSection("Effects") },
  { id: "panel.deform", title: "Deform", group: "Panels", keywords: ["bend", "twist", "curl"], icon: CmdIcons.warp, when: () => !!single() && single()!.type !== "group" && isGeometric(single()), hint: selHint, run: () => revealSection("Deform") },
  { id: "panel.layers", title: "Layers panel", group: "Panels", keywords: ["tree", "outline"], icon: Icons.group, run: () => showSideTab("layers") },
  { id: "panel.history", title: "History panel", group: "Panels", keywords: ["undo", "steps", "timeline", "versions"], icon: Icons.history, run: () => showSideTab("history") },
  { id: "panel.code", title: "Code view", group: "Panels", keywords: ["svg", "source", "markup"], icon: QIcons.code, hint: () => selHint() ?? versionHint(), run: () => showSideTab("code") },
  { id: "panel.design", title: "Design panel", group: "Panels", keywords: ["properties", "inspector"], icon: CmdIcons.sliders, run: () => showSideTab("design") },
  {
    id: "panel.vectorize",
    title: "Vectorize reference image…",
    group: "Panels",
    keywords: ["trace", "photo", "bitmap", "vector"],
    icon: Icons.image,
    when: () => single()?.type === "reference",
    hint: selHint,
    run: () => openVectorize(single()!.id),
  },
  {
    id: "anim.play",
    title: "Play animation",
    group: "Panels",
    keywords: ["animation", "preview", "motion", "pause"],
    icon: CmdIcons.play,
    when: () => !!frameNode()?.animation,
    hint: versionHint,
    run: () => player.toggle(),
  },

  // ── AI
  { id: "ai.chat", title: "Ask your AI…", group: "AI", shortcut: "/", keywords: ["chat", "prompt", "claude", "codex", "request"], icon: CmdIcons.ai, hint: () => (layers().length ? `about ${plural(layers().length, "layer")}` : "canvas chat"), run: () => focusChat() },
  {
    id: "ai.notes",
    title: "Copy notes for your AI",
    group: "AI",
    keywords: ["annotations", "prompt", "clipboard", "feedback"],
    icon: Icons.comment,
    when: () => !!doc() && Object.values(doc()!.annotations).some((a) => a.status === "pending"),
    hint: () => plural(Object.values(doc()!.annotations).filter((a) => a.status === "pending").length, "note"),
    run: () => copyNotes(doc()!, Object.values(doc()!.annotations).filter((a) => a.status === "pending")),
  },
  {
    id: "ai.applyNotes",
    title: "Ask your AI to apply my notes",
    group: "AI",
    keywords: ["annotations", "feedback", "fix"],
    icon: CmdIcons.ai,
    when: () => !!doc() && Object.values(doc()!.annotations).some((a) => a.status === "pending"),
    hint: () => plural(Object.values(doc()!.annotations).filter((a) => a.status === "pending").length, "note"),
    run: () => askAi("Apply my pending notes on the canvas (get_annotations), then resolve each one with a short reply."),
  },
  {
    id: "ai.variants",
    title: "Continue with this variant",
    group: "AI",
    keywords: ["variant", "pick", "choose", "keep"],
    icon: Icons.frame,
    when: () => {
      const f = frameNode();
      return !!f?.batch && variantsOf(doc()!, f.batch).length > 1;
    },
    hint: versionHint,
    run: () => {
      const f = frameNode()!;
      dispatch(continueWithVariantOps(doc()!, f.id), `Continue with ${f.name}`);
      setActiveFrame(f.id);
    },
  },

  // ── Versions & documents (static parts)
  {
    id: "version.new",
    title: "New version from the active one",
    group: "Versions",
    shortcut: "⌘D",
    keywords: ["duplicate", "branch", "variant", "copy version", "frame"],
    icon: Icons.plus,
    hint: versionHint,
    run: () => {
      const id = activeFrameId();
      if (!id) return;
      select([id]);
      duplicateSelection();
    },
  },
  { id: "doc.new", title: "New logo", group: "Documents", keywords: ["create", "document", "file", "blank"], icon: Icons.plus, run: () => socket.send({ t: "create", name: "Untitled logo" }) },
];

registerCommands(statics);

// ── Versions: jump to one and fit it on screen.
registerProvider("versions", () => {
  const d = doc();
  if (!d) return [];
  const active = activeFrameId(d);
  return listFrames(d).map(
    (f): Command => ({
      id: `version:${f.id}`,
      title: f.name,
      group: "Versions",
      keywords: ["version", "frame", "artboard", "jump", "go to"],
      icon: Icons.frame,
      hint: `${f.id === active ? "active · " : ""}${f.width}×${f.height} · ${plural(f.children.length, "layer")}`,
      run: () => {
        const cur = doc();
        if (!cur || !findFrame(cur, f.id)) return;
        setActiveFrame(f.id);
        select([]);
        useStore.setState({ camera: fitFrame(cur, f.id) });
      },
    }),
  );
});

// ── Layers of the active version: select one.
registerProvider("layers", (query) => {
  const d = doc();
  const fid = d ? activeFrameId(d) : null;
  const f = fid ? d!.nodes[fid] : null;
  if (!d || !f || f.type !== "frame") return [];
  const out: Command[] = [];
  const walk = (ids: string[], path: string) => {
    for (const id of [...ids].reverse()) {
      const n = d.nodes[id];
      if (!n) continue;
      const flags = [!n.visible && "hidden", n.locked && "locked", n.aiLock && "AI-locked"].filter(Boolean).join(" · ");
      out.push({
        id: `layer:${id}`,
        title: nodeLabel(n),
        group: "Layers",
        keywords: ["layer", n.type, n.type === "shape" ? n.shape : "", n.type === "text" ? n.text : "", path].filter(Boolean),
        icon: Icons[NODE_ICON[n.type] ?? "path"],
        hint: [path ? `in ${path}` : n.type === "shape" ? n.shape : n.type, flags].filter(Boolean).join(" · "),
        run: () => {
          if (!doc()?.nodes[id]) return;
          if (n.locked) toast("That layer is locked — unlock it in the Layers panel to edit it");
          select([id]);
          useStore.setState({ flashIds: [id] });
          setTimeout(() => useStore.getState().flashIds.includes(id) && useStore.setState({ flashIds: [] }), 1200);
        },
      });
      if (n.type === "group") walk(n.children, path ? `${path} › ${nodeLabel(n)}` : nodeLabel(n));
    }
  };
  walk(f.children, "");
  // Without a query, only the top of the stack (type to find the rest).
  return query.trim() ? out : out.slice(0, 6);
});

// ── Documents in this folder.
registerProvider("documents", () => {
  const s = S();
  return s.docs.map(
    (m): Command => ({
      id: `doc:${m.id}`,
      title: m.name,
      group: "Documents",
      keywords: ["open", "document", "logo", "file", m.file],
      icon: CmdIcons.doc,
      hint: m.id === s.doc?.id ? `current · ${m.file}` : m.file,
      when: () => m.id !== S().doc?.id,
      run: () => socket.send({ t: "open", id: m.id }),
    }),
  );
});

// ── History: jump to any step.
registerProvider("history", (query) => {
  const tl = S().timeline;
  const current = tl.offset + tl.cursor;
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const rows = tl.items
    .map((it, i) => ({ it, step: tl.offset + i + 1 }))
    .reverse()
    .map(
      ({ it, step }): Command => ({
        id: `history:${step}`,
        title: it.label,
        group: "History",
        keywords: ["history", "step", "go back", "undo", it.author === "agent" ? "ai" : "you"],
        icon: Icons.history,
        hint: `${it.author === "agent" ? "AI" : "You"} · ${time(it.at)} · ${step === current ? "now" : `step ${step}`}`,
        run: () => socket.send({ t: "goto", index: step }),
      }),
    );
  return query.trim() ? rows : rows.slice(0, 4);
});

export function contextLine(): string {
  const d = doc();
  if (!d) return "";
  const v = versionHint();
  const n = layers().length;
  return [v && `Version ${v}`, n ? `${plural(n, "layer")} selected` : null].filter(Boolean).join(" · ");
}

export { focusChat };
