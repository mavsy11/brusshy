import type { DocT, NodeT, PaintT, ReferenceNodeT } from "@brusshy/core";
import { dispatch, useStore } from "../lib/store";
import { copyAsPng, copyAsSvg, normColor, usePalette } from "../lib/quick";
import { QIcons } from "./quickIcons";
import { BrandSwatches } from "../palette/BrandSwatches";
import "../styles/quickwins.css";

/** The node (itself or an ancestor) whose AI lock applies, or null. */
export function aiLockSource(doc: DocT, id: string): NodeT | null {
  let n: NodeT | undefined = doc.nodes[id];
  while (n) {
    if (n.aiLock) return n;
    n = n.parent ? doc.nodes[n.parent] : undefined;
  }
  return null;
}

const toggleAiLock = (n: NodeT) => dispatch([{ op: "update", id: n.id, set: { aiLock: !n.aiLock } }], n.aiLock ? "Unlock for AI" : "Lock for AI");

/** Layers panel: per-row toggle, distinct from the normal lock. */
export function AiLockMiniButton({ doc, n }: { doc: DocT; n: NodeT }) {
  const src = aiLockSource(doc, n.id);
  const inherited = !n.aiLock && !!src;
  return (
    <button
      className={`mini-btn ai-lock-btn${n.aiLock ? " pinned on" : ""}${inherited ? " inherited" : ""}`}
      onClick={(e) => (e.stopPropagation(), toggleAiLock(n))}
      aria-label={n.aiLock ? "Unlock for AI" : "Lock for AI"}
      aria-pressed={n.aiLock}
      title={n.aiLock ? "Locked for your AI — it can't change this. Click to unlock." : inherited ? `Locked for your AI via “${src!.name || src!.type}”` : "Lock for AI: your AI won't change this part (you still can)"}
    >
      {n.aiLock || inherited ? QIcons.aiLock : QIcons.aiUnlock}
    </button>
  );
}

/** Properties panel: "Lock for AI" checkbox with an explanation. */
export function AiLockCheck({ doc, n }: { doc: DocT; n: NodeT }) {
  const src = aiLockSource(doc, n.id);
  const inherited = !n.aiLock && src;
  return (
    <div className={`ai-lock-row${n.aiLock || inherited ? " on" : ""}`}>
      <label className="check" title="Your AI can read this part but any change to it is refused. You can still edit it.">
        <input type="checkbox" checked={n.aiLock} onChange={() => toggleAiLock(n)} />
        <span className="ai-lock-icon">{QIcons.aiLock}</span>
        Lock for AI
      </label>
      <span className="muted">{inherited ? `Locked via “${src.name || src.type}”` : n.aiLock ? "Your AI won't change this" : "Your AI can edit it"}</span>
    </div>
  );
}

export const ROLES: { id: ReferenceNodeT["role"]; label: string; hint: string }[] = [
  { id: "reference", label: "Reference", hint: "General inspiration: your AI traces its structure, never copies it." },
  { id: "palette", label: "Palette", hint: "Your AI takes only its colors and ignores its shapes." },
  { id: "silhouette", label: "Silhouette", hint: "Your AI matches its outer shape and proportions, not its colors." },
  { id: "style", label: "Style", hint: "Your AI matches its look — stroke weight, corners, texture, era." },
];

/** Properties → Reference image: what the AI should take from it. */
export function ReferenceRole({ n }: { n: ReferenceNodeT }) {
  const role = ROLES.find((r) => r.id === n.role) ?? ROLES[0]!;
  return (
    <div className="ref-role">
      <span className="label">Use for</span>
      <div className="ref-role-seg" role="radiogroup" aria-label="Reference role">
        {ROLES.map((r) => (
          <button
            key={r.id}
            role="radio"
            aria-checked={r.id === n.role}
            className={`ref-role-opt${r.id === n.role ? " on" : ""}`}
            onClick={() => r.id !== n.role && dispatch([{ op: "update", id: n.id, set: { role: r.id } }], `Reference role: ${r.label}`)}
            title={r.hint}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="muted ref-role-hint">{role.hint}</p>
    </div>
  );
}

const paintKey = (p: PaintT) => (typeof p === "string" ? normColor(p) : null);

/** One-click swatches of the colors already used in the active version (most used first). */
export function DocSwatches({ paint, onPick, max = 14 }: { paint: PaintT; onPick: (c: string) => void; max?: number }) {
  const palette = usePalette();
  const cur = paintKey(paint);
  const brand = <BrandSwatches cur={cur} onPick={onPick} />;
  if (!palette.length) return brand;
  return (
    <>
    {brand}
    <div className="doc-swatches" role="listbox" aria-label="Colors in this version">
      {palette.slice(0, max).map(({ color, count }) => (
        <button
          key={color}
          role="option"
          aria-selected={color === cur}
          className={`doc-swatch${color === cur ? " on" : ""}`}
          style={{ ["--c" as string]: color }}
          onClick={() => onPick(color)}
          title={`${color} · used ${Math.round(count)}×`}
        />
      ))}
    </div>
    </>
  );
}

/** Copy buttons for the version panel. */
export function CopyAsButtons() {
  const sel = useStore((s) => s.selection.length);
  return (
    <div className="copy-as">
      <button className="btn small" onClick={() => void copyAsSvg()} title={`Copy ${sel ? "the selection" : "this version"} as SVG (⇧⌘C)`}>
        {QIcons.copySvg} Copy SVG
      </button>
      <button className="btn small" onClick={() => void copyAsPng()} title={`Copy ${sel ? "the selection" : "this version"} as PNG (⌥⇧⌘C)`}>
        {QIcons.image} Copy PNG
      </button>
    </div>
  );
}
