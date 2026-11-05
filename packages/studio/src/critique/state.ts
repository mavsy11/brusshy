import { create } from "zustand";
import {
  critique,
  critiqueFixPrompt,
  critiqueNoteOps,
  critiqueText,
  findFrame,
  frameDoc,
  type CritiqueCategoryId,
  type CritiqueFinding,
  type CritiqueReport,
  type DocT,
  type FrameNodeT,
} from "@brusshy/core";
import { activeFrameId, dispatch, setActiveFrame, toast, useStore } from "../lib/store";
import { socket } from "../lib/socket";
import { copyText } from "../lib/notes";
import { textGlyphs } from "../lib/fonts";
import { fitFrame, getViewport, SAFE, toScreen } from "../canvas/camera";
import { animateCamera } from "../canvas/cameraAnim";

/** UI state of the critique panel (kept out of the main store so the feature stays independent). */
interface CritiqueUi {
  open: boolean;
  /** Version under review (follows the active version). */
  frameId: string | null;
  report: CritiqueReport | null;
  /** Finding pinned in focus (clicked) and the one under the pointer. */
  focus: string | null;
  hover: string | null;
  /** Show only one category's findings. */
  filter: CritiqueCategoryId | null;
  /** Notes the last "Pin" created (notes live outside the undo history, so the panel offers its own undo). */
  pinned: string[];
}

export const useCritique = create<CritiqueUi>(() => ({ open: false, frameId: null, report: null, focus: null, hover: null, filter: null, pinned: [] }));

/** Panel geometry (CSS px) — the camera keeps the version visible beside it. */
export const PANEL = { left: 76, width: 360, gap: 28 };

/** Run the checks on one version with the studio's real glyph outlines. */
export function runCritique(doc: DocT, frameId: string): CritiqueReport | null {
  const f = findFrame(doc, frameId);
  if (!f) return null;
  return critique(frameDoc(doc, f.id), { name: f.name, textGlyphs: (n) => textGlyphs(n) });
}

/** Fit a version into the canvas area right of the panel (after any glide the click started). */
export function fitBeside(frameId: string) {
  setTimeout(() => {
    const doc = useStore.getState().doc;
    if (!doc?.nodes[frameId]) return;
    const prev = SAFE.left;
    SAFE.left = PANEL.left + PANEL.width + PANEL.gap;
    let cam;
    try {
      cam = fitFrame(doc, frameId);
    } finally {
      SAFE.left = prev;
    }
    animateCamera(cam);
  }, 0);
}

export function openCritique(frameId?: string | null) {
  const doc = useStore.getState().doc;
  if (!doc) return;
  const fid = (frameId ? findFrame(doc, frameId)?.id : null) ?? activeFrameId(doc);
  if (!fid) return;
  setActiveFrame(fid);
  useCritique.setState({ open: true, frameId: fid, focus: null, hover: null, filter: null, pinned: [] });
  fitBeside(fid);
}

export function closeCritique() {
  useCritique.setState({ open: false, focus: null, hover: null });
}

export function toggleCritique() {
  if (useCritique.getState().open) closeCritique();
  else openCritique();
}

/** Findings the panel lists right now (all, or one category). */
export function visibleFindings(r: CritiqueReport | null, filter: CritiqueCategoryId | null): CritiqueFinding[] {
  if (!r) return [];
  return filter ? r.findings.filter((f) => f.category === filter) : r.findings;
}

/** Focus a finding: highlight it and pan so its area is in view beside the panel. */
export function focusFinding(id: string | null) {
  useCritique.setState({ focus: id });
  const { report, frameId } = useCritique.getState();
  const doc = useStore.getState().doc;
  const f = report?.findings.find((x) => x.id === id);
  if (!f || !doc || !frameId) return;
  const frame = doc.nodes[frameId] as FrameNodeT | undefined;
  if (!frame) return;
  const cam = useStore.getState().camera;
  const box = f.box ?? { x: f.x - 1, y: f.y - 1, w: 2, h: 2 };
  const [x0, y0] = toScreen(cam, frame.transform.x + box.x, frame.transform.y + box.y);
  const [x1, y1] = toScreen(cam, frame.transform.x + box.x + box.w, frame.transform.y + box.y + box.h);
  const vp = getViewport();
  const left = PANEL.left + PANEL.width + PANEL.gap;
  const right = vp.w - SAFE.right - 24;
  const top = SAFE.top + 12;
  const bottom = vp.h - SAFE.bottom - 24;
  if (x0 >= left && x1 <= right && y0 >= top && y1 <= bottom) return;
  // Centre the area in the free space (zooming out if it does not fit).
  const fit = Math.min(1, (right - left) / Math.max(1, x1 - x0), (bottom - top) / Math.max(1, y1 - y0));
  const zoom = cam.zoom * Math.min(1, fit * 0.9);
  const wx = frame.transform.x + box.x + box.w / 2;
  const wy = frame.transform.y + box.y + box.h / 2;
  animateCamera({ zoom, x: (left + right) / 2 - wx * zoom, y: (top + bottom) / 2 - wy * zoom });
}

export function pinFindings(findings: CritiqueFinding[]) {
  const doc = useStore.getState().doc;
  const { frameId } = useCritique.getState();
  if (!doc || !frameId || !findings.length) return;
  const ops = critiqueNoteOps(frameId, findings, doc);
  if (!ops.length) return toast("Those notes are already pinned");
  const created = dispatch(ops, ops.length === 1 ? "Pin critique note" : `Pin ${ops.length} critique notes`);
  if (created) {
    useStore.setState({ showAnnotations: true });
    useCritique.setState({ pinned: created });
    toast(`Pinned ${ops.length} note${ops.length === 1 ? "" : "s"} on the canvas`);
  }
}

/** Take back the notes the last pin created (the ones still there). */
export function unpinLast() {
  const doc = useStore.getState().doc;
  const ids = useCritique.getState().pinned.filter((id) => doc?.annotations[id]);
  useCritique.setState({ pinned: [] });
  if (ids.length) dispatch(ids.map((id) => ({ op: "unannotate" as const, id })), "Remove critique notes");
}

export function askAiToFix(findings: CritiqueFinding[]) {
  const { report, frameId } = useCritique.getState();
  const chat = useStore.getState().chat;
  if (!report || !frameId || !findings.length) return;
  const prompt = critiqueFixPrompt(report, findings);
  if (!chat) {
    void copyText(prompt).then((ok) => toast(ok ? "Copied the fixes as a prompt — paste it in your AI's chat" : "Couldn't reach the chat or the clipboard", ok ? "info" : "error"));
    return;
  }
  if (chat.busy) return toast("Your AI is still working on the last request");
  socket.send({ t: "chat", text: prompt, frame: frameId, selection: [] });
  toast(`Sent ${findings.length} fix${findings.length === 1 ? "" : "es"} to your AI`, "agent");
}

export function askAiReview() {
  const { report, frameId } = useCritique.getState();
  const chat = useStore.getState().chat;
  if (!report || !frameId) return;
  const prompt = `Critique version "${report.frame.name}" with the critique tool: add your own design judgement (concept fit with the brief, originality, memorability) and pin the actionable findings as notes on the canvas. Don't change the design.`;
  if (!chat) {
    void copyText(prompt).then((ok) => ok && toast("Copied — paste it in your AI's chat"));
    return;
  }
  if (chat.busy) return toast("Your AI is still working on the last request");
  socket.send({ t: "chat", text: prompt, frame: frameId, selection: [] });
  toast("Asked your AI for a full review", "agent");
}

export async function copyReport() {
  const r = useCritique.getState().report;
  if (!r) return;
  if (await copyText(critiqueText(r))) toast("Copied the critique");
  else toast("Your browser blocked the clipboard", "error");
}
