import { useStore } from "../lib/store";
import { cornerSelectedNodes, selectAllNodes, smoothSelectedNodes } from "../lib/nodeTools";

/** Floating bar while editing nodes: smoothing, corners, and soft (proportional) selection. */
export function NodeBar() {
  const tool = useStore((s) => s.tool);
  const editingId = useStore((s) => s.editingId);
  const count = useStore((s) => s.nodeSel.length);
  const soft = useStore((s) => s.softRadius);
  if (tool !== "node" || !editingId) return null;
  return (
    <div className="panel node-bar" data-ui>
      <button className="btn small ghost" onClick={selectAllNodes} title="Select every node (⌘A)">
        All nodes
      </button>
      <button className="btn small ghost" onClick={smoothSelectedNodes} title="Round the selected nodes (or the whole path) into smooth curves">
        Smooth
      </button>
      <button className="btn small ghost" onClick={cornerSelectedNodes} title="Make the selected nodes (or all) sharp corners">
        Corner
      </button>
      <div className="vsep" />
      <label className="check mini" title="Nearby nodes follow the ones you move, fading out smoothly">
        <input type="checkbox" checked={soft > 0} onChange={(e) => useStore.setState({ softRadius: e.target.checked ? 160 : 0 })} />
        Soft selection
      </label>
      {soft > 0 && (
        <>
          <input type="range" min={20} max={600} value={soft} onChange={(e) => useStore.setState({ softRadius: Number(e.target.value) })} />
          <span className="num">{soft}</span>
        </>
      )}
      <div className="vsep" />
      <span className="hint">{count >= 2 ? "Drag the ◯ pivot, then rotate or scale the selection" : "Drag on empty space to box-select nodes"}</span>
    </div>
  );
}
