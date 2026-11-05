import { listFrames, type DocT, type FrameNodeT } from "@brusshy/core";
import { openCritique, useCritique } from "./state";
import { openCompare } from "../compare/state";

const CritiqueIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5M8 10.8l1.8 1.8 3.2-3.6" />
  </svg>
);

const CompareIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M12 3v18" />
    <path d="M7 9.5h2M7 12h2M15 12h2M15 14.5h2" />
  </svg>
);

/** Version panel: review this version, or compare it with another. */
export function VersionReview({ doc, f }: { doc: DocT; f: FrameNodeT }) {
  const open = useCritique((s) => s.open && s.frameId === f.id);
  const many = listFrames(doc).length > 1;
  return (
    <div className="version-review">
      <button className={`btn small${open ? " primary" : ""}`} onClick={() => openCritique(f.id)} title="A senior-designer review: small sizes, balance, contrast, complexity, consistency, alignment, spacing">
        {CritiqueIcon} Critique
      </button>
      <button className="btn small" onClick={() => openCompare(f.id)} disabled={!many} title={many ? "Before / after with the previous version" : "Duplicate this version (⌘D) to have something to compare"}>
        {CompareIcon} Compare
      </button>
    </div>
  );
}
