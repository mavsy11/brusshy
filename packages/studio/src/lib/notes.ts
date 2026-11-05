import { frameOf, listFrames, type AnnotationT, type DocT } from "@brusshy/core";
import { toast } from "./store";

const target = (doc: DocT, a: AnnotationT) => {
  const n = a.nodeId ? doc.nodes[a.nodeId] : undefined;
  const f = a.frameId ? doc.nodes[a.frameId] : n ? frameOf(doc, n.id) : null;
  const part = n && n.type !== "frame" ? `"${n.name || (n.type === "text" ? n.text : n.type === "shape" ? n.shape : n.type)}" (${n.id})` : "the artboard";
  const version = f && listFrames(doc).length > 1 ? ` in version ${f.name}` : "";
  return `${part}${version}`;
};

/** Notes as a ready-to-paste prompt for the user's AI (like Agentation's copy button). */
export function notesPrompt(doc: DocT, notes: AnnotationT[]): string {
  const lines = notes.map((a, i) => `${i + 1}. On ${target(doc, a)} at (${Math.round(a.x)}, ${Math.round(a.y)}): ${a.note}`);
  return [
    `Brusshy notes on "${doc.name}":`,
    ...lines,
    "",
    "Apply these on the Brusshy canvas (brusshy MCP): check each part, make the change, verify with render_preview, and resolve each note (resolve_annotation) with a one-line reply.",
  ].join("\n");
}

/** Copy text: async Clipboard API, then the legacy execCommand path (works in more embedded browsers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export async function copyNotes(doc: DocT, notes: AnnotationT[]) {
  if (!notes.length) return toast("No notes to copy");
  if (await copyText(notesPrompt(doc, notes))) toast(`Copied ${notes.length} note${notes.length === 1 ? "" : "s"} — paste them in your AI's chat or terminal`);
  else toast("Your browser blocked the clipboard — try again from a normal browser tab", "error");
}
