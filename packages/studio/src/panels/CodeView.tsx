import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applyOps, docToSvg, frameDoc, frameOf, svgToOps, type DocT, type NodeT, type OpT } from "@brusshy/core";
import { activeFrameId, dispatch, select, toast, useStore } from "../lib/store";
import { topSelection } from "../lib/actions";
import { copyText } from "../lib/notes";
import { QIcons } from "./quickIcons";
import { Icons } from "./icons";
import "../styles/quickwins.css";

const CODE_TYPES: NodeT["type"][] = ["path", "shape", "text", "group"];

/** Pretty-print SVG markup: one element per line, indented by depth. */
export function prettyXml(xml: string): string {
  const lines = xml.replace(/>\s*</g, ">\n<").split("\n");
  let depth = 0;
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const closing = /^<\//.test(line);
    const selfClosing = /\/>$/.test(line) || /^<[^>]+>.*<\/[^>]+>$/.test(line) || /^<[?!]/.test(line);
    if (closing) depth = Math.max(0, depth - 1);
    out.push("  ".repeat(depth) + line);
    if (!closing && !selfClosing && /^</.test(line)) depth++;
  }
  return out.join("\n");
}

const TOKEN = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:.-]*)|([A-Za-z_:][\w:.-]*)(=)("[^"]*"|'[^']*')|(\/?>)/g;

/** Light syntax highlighting for SVG (tags, attributes, values; geometry data dimmed). */
export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of code.matchAll(TOKEN)) {
    if (m.index! > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="tok-com">{m[1]}</span>);
    else if (m[2]) {
      out.push(<span key={k++} className="tok-punct">{m[2]}</span>);
      out.push(<span key={k++} className="tok-tag">{m[3]}</span>);
    } else if (m[4]) {
      const data = m[4] === "d" || m[4] === "points" || m[4] === "transform";
      out.push(<span key={k++} className="tok-attr">{m[4]}</span>);
      out.push(<span key={k++} className="tok-punct">=</span>);
      out.push(<span key={k++} className={data ? "tok-data" : "tok-val"}>{m[6]}</span>);
    } else if (m[7]) out.push(<span key={k++} className="tok-punct">{m[7]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

interface Scope {
  /** Rendered SVG (layer names as data-name). */
  code: string;
  /** Parent the layers live in (frame or group). */
  parent: string;
  /** Layers the code stands for (what Apply replaces). */
  ids: string[];
  label: string;
  kind: "selection" | "version";
  /** Why Apply is unavailable for this scope, if it is. */
  blocked?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function buildScope(doc: DocT, selection: string[]): Scope | null {
  const sel = topSelection(doc, selection).filter((id) => doc.nodes[id]?.type !== "frame");
  const selFrame = sel.length ? frameOf(doc, sel[0]) : null;
  const fid = selFrame?.id ?? (doc.nodes[selection[0] ?? ""]?.type === "frame" ? selection[0]! : activeFrameId(doc));
  const frame = fid ? doc.nodes[fid] : undefined;
  if (!frame || frame.type !== "frame") return null;
  const fd = frameDoc(doc, frame.id);
  const shown = (id: string) => !!doc.nodes[id] && doc.nodes[id]!.visible && CODE_TYPES.includes(doc.nodes[id]!.type);
  let ids: string[];
  let parent = frame.id;
  let label: string;
  let blocked: string | undefined;
  if (sel.length) {
    const parents = new Set(sel.map((id) => doc.nodes[id]!.parent));
    parent = doc.nodes[sel[0]!]!.parent ?? frame.id;
    if (parents.size > 1) blocked = "Select layers that share a group to edit them as code.";
    if (sel.some((id) => frameOf(doc, id)?.id !== frame.id)) blocked = "Select layers from one version at a time.";
    ids = sel.filter(shown);
    label = sel.length === 1 ? `“${doc.nodes[sel[0]!]!.name || doc.nodes[sel[0]!]!.type}”` : `${sel.length} layers`;
    if (!ids.length) blocked = "Hidden layers, sketches and references have no SVG code.";
  } else {
    ids = frame.children.filter(shown);
    label = frame.name;
  }
  // Selected layers keep their parent's (version-local) coordinates — the same ones the AI uses.
  let code = docToSvg({ ...fd, root: ids }, { dataIds: true });
  code = code.replace(/ data-id="([^"]+)"/g, (_m, id: string) => {
    const n = doc.nodes[id];
    return n?.name ? ` data-name="${esc(n.name)}"` : "";
  });
  return { code: prettyXml(code), parent, ids, label, blocked, kind: sel.length ? "selection" : "version" };
}

/** Ops that swap the scope's layers for the edited SVG (one undo step), or an error. */
function applyPlan(doc: DocT, scope: Scope, code: string): { ops: OpT[]; ids: string[]; count: number } | { error: string } {
  let imported: ReturnType<typeof svgToOps>;
  const parentNode = doc.nodes[scope.parent];
  const sibs = parentNode && (parentNode.type === "group" || parentNode.type === "frame") ? parentNode.children : doc.root;
  const indices = scope.ids.map((id) => sibs.indexOf(id)).filter((i) => i >= 0);
  const index = indices.length ? Math.min(...indices) : sibs.length;
  // Strict well-formedness first (the importer itself is lenient and would guess).
  const parsed = new DOMParser().parseFromString(code, "image/svg+xml");
  const perr = parsed.querySelector("parsererror");
  if (perr) {
    const line = /line (\d+)/i.exec(perr.textContent ?? "")?.[1];
    return { error: `Not valid SVG${line ? ` (line ${line})` : ""}: check for unclosed tags or quotes.` };
  }
  if (parsed.documentElement.localName !== "svg") return { error: "The code must be one <svg> element." };
  try {
    imported = svgToOps(code, { parent: scope.parent, index });
  } catch (e) {
    return { error: `Not valid SVG: ${(e as Error).message}` };
  }
  if (!imported.ops.length) return { error: "No drawable elements (path, rect, circle, ellipse, polygon, line, text, g)." };
  // Carry 3D settings and locks over to re-imported layers with the same name.
  const byName = new Map<string, NodeT>();
  for (const id of scope.ids) {
    const n = doc.nodes[id];
    if (n?.name) byName.set(n.name, n);
  }
  const adds = imported.ops.map((o) => {
    if (o.op !== "add") return o;
    const prev = typeof o.node.name === "string" ? byName.get(o.node.name) : undefined;
    if (!prev) return o;
    return { ...o, node: { ...o.node, ...(prev.extrude ? { extrude: prev.extrude } : {}), aiLock: prev.aiLock, locked: prev.locked } };
  });
  const ops: OpT[] = [...scope.ids.map((id) => ({ op: "remove", id }) as OpT), ...adds];
  try {
    applyOps(doc, ops);
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ops, ids: imported.ids, count: adds.length };
}

/**
 * Code view: the SVG of the selection (or the active version), lightly highlighted.
 * Edit it and Apply re-imports it as one undo step — only if it validates.
 */
export function CodeView() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const active = useStore((s) => s.activeFrame);
  const scope = useMemo(() => (doc ? buildScope(doc, selection) : null), [doc, selection, active]);
  const [draft, setDraft] = useState<string | null>(null);
  const [scopeKey, setScopeKey] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const key = scope ? `${scope.parent}:${scope.ids.join(",")}` : "";
  // A different selection starts a fresh draft.
  useEffect(() => {
    if (key !== scopeKey) {
      setScopeKey(key);
      setDraft(null);
    }
  }, [key, scopeKey]);
  const code = draft ?? scope?.code ?? "";
  const shown = useDeferredValue(code);
  const tokens = useMemo(() => highlight(shown), [shown]);
  const dirty = draft !== null && draft !== scope?.code;
  const plan = useMemo(() => (doc && scope && dirty ? applyPlan(doc, scope, draft!) : null), [doc, scope, dirty, draft]);

  if (!doc || !scope) return <p className="muted pad">No version to show.</p>;

  const apply = () => {
    if (!plan || "error" in plan || scope.blocked) return;
    const r = dispatch(plan.ops, "Edit SVG code");
    if (!r) return;
    select(plan.ids);
    setDraft(null);
    toast(`Applied SVG — ${plan.count} layer${plan.count === 1 ? "" : "s"} (⌘Z to undo)`);
  };
  const copy = async () => {
    if (await copyText(code)) toast("SVG code copied");
    else toast("Your browser blocked the clipboard", "error");
  };
  const lines = code.split("\n").length;
  const kb = new Blob([code]).size / 1024;

  return (
    <div className="code-view">
      <div className="code-head">
        <div className="code-scope">
          <span className="label">{scope.kind === "version" ? "Version" : "Selection"}</span>
          <span className="code-scope-name">{scope.label}</span>
        </div>
        <div className="code-actions">
          <button className="icon-btn small" onClick={() => void copy()} aria-label="Copy SVG code">
            {Icons.copy}
            <span className="tip below">Copy code</span>
          </button>
          {dirty && (
            <button className="btn small ghost" onClick={() => setDraft(null)} title="Discard your edits">
              Reset
            </button>
          )}
          <button className="btn small primary" disabled={!dirty || !plan || "error" in plan || !!scope.blocked} onClick={apply} title="Replace these layers with the edited SVG (⌘↩)">
            Apply
          </button>
        </div>
      </div>
      <div className="code-scroll scroll-y">
        <div className="code-wrap">
          <pre className="code-hl" aria-hidden>
            {tokens}
            {"\n"}
          </pre>
          <textarea
            ref={taRef}
            className="code-input"
            value={code}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="SVG code"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                apply();
              }
              if (e.key === "Escape" && dirty) setDraft(null);
              if (e.key === "Tab") {
                e.preventDefault();
                const ta = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = ta;
                const next = code.slice(0, a) + "  " + code.slice(b);
                setDraft(next);
                requestAnimationFrame(() => ta.setSelectionRange(a + 2, a + 2));
              }
            }}
          />
        </div>
      </div>
      <div className={`code-status${plan && "error" in plan ? " bad" : dirty && plan ? " good" : ""}`}>
        {scope.blocked ? (
          <span>{scope.blocked}</span>
        ) : plan && "error" in plan ? (
          <span>{plan.error}</span>
        ) : dirty && plan ? (
          <span>
            {QIcons.check} Valid · {plan.count} layer{plan.count === 1 ? "" : "s"} · ⌘↩ to apply
          </span>
        ) : (
          <span>
            {lines} lines · {kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB · edit to change the design
          </span>
        )}
      </div>
    </div>
  );
}
