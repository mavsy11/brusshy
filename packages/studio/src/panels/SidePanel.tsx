import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { Properties } from "./Properties";
import { Layers } from "./Layers";
import { History } from "./History";
import { CodeView } from "./CodeView";
import { QIcons } from "./quickIcons";
import { t } from "../lib/i18n";

/** Right-hand panel: Design (properties) and Layers tabs. */
export function SidePanel() {
  const [tab, setTab] = useState<"design" | "layers" | "history" | "code">("design");
  // The command palette switches tabs (palette-cmd/reveal.ts).
  useEffect(() => {
    const on = (e: Event) => setTab((e as CustomEvent<typeof tab>).detail);
    window.addEventListener("brusshy:side-tab", on);
    return () => window.removeEventListener("brusshy:side-tab", on);
  }, []);
  const count = useStore((s) => (s.doc ? Object.keys(s.doc.nodes).length : 0));
  return (
    <div className="panel side-panel" data-ui>
      <div className="tabs">
        <button className={`tab${tab === "design" ? " on" : ""}`} onClick={() => setTab("design")}>
          {t("panel.design")}
        </button>
        <button className={`tab${tab === "layers" ? " on" : ""}`} onClick={() => setTab("layers")}>
          {t("panel.layers")} {count > 0 && <span className="count">{count}</span>}
        </button>
        <button className={`tab${tab === "history" ? " on" : ""}`} onClick={() => setTab("history")}>
          History
        </button>
        <button className={`tab tab-code${tab === "code" ? " on" : ""}`} onClick={() => setTab("code")} title="SVG code of the selection or version" aria-label="Code">
          {QIcons.code}
        </button>
      </div>
      {tab === "code" ? <CodeView /> : <div className="side-body scroll-y">{tab === "design" ? <Properties /> : tab === "layers" ? <Layers /> : <History />}</div>}
    </div>
  );
}
