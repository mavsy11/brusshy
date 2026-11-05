import { useStore } from "./lib/store";
import { useShortcuts } from "./lib/shortcuts";
import { Canvas2D } from "./canvas/Canvas2D";
import { View3D } from "./three/View3D";
import { Toolbar } from "./panels/Toolbar";
import { TopBar } from "./panels/TopBar";
import { SidePanel } from "./panels/SidePanel";
import { Help } from "./panels/Help";
import { ExportDialog } from "./export/ExportDialog";
import { ExportSuccess } from "./export/ExportSuccess";
import { ZoomControls } from "./panels/ZoomControls";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { NodeBar } from "./panels/NodeBar";
import { ChatDock } from "./panels/Chat";
import { VectorizeDialog } from "./vectorize/VectorizeDialog";
import { MockupsDialog } from "./mockups/MockupsDialog";
import { FontsDialog } from "./typeset/FontsDialog";
import { PaletteDialog } from "./palette/PaletteDialog";
import { CritiquePanel } from "./critique/CritiquePanel";
import { CompareView } from "./compare/CompareView";
import { CommandPalette } from "./palette-cmd/CommandPalette";
import { TimelapsePlayer } from "./timelapse/TimelapsePlayer";
import { ExploreDialogs } from "./explore/Dialogs";
import { Presentation } from "./present/Presentation";
import { Stage } from "./stage/Stage";

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  useShortcuts();
  const view = useStore((s) => s.view);
  const doc = useStore((s) => s.doc);
  const exportOpen = useStore((s) => s.exportOpen);
  const connected = useStore((s) => s.connected);
  const tool = useStore((s) => s.tool);
  const rulers = useStore((s) => s.showRulers);
  return (
    <div className={`app view-${view}${rulers ? " rulers" : ""}`}>
      <div className="stage">
        {view !== "3d" && (
          <div className="pane pane-2d">
            <ErrorBoundary label="The canvas">
              <Canvas2D />
            </ErrorBoundary>
          </div>
        )}
        {view !== "2d" && doc && (
          <div className="pane pane-3d">
            <ErrorBoundary label="The 3D view">
              <View3D />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <TopBar />
      <Toolbar />
      <ErrorBoundary label="The side panel">
        <SidePanel />
      </ErrorBoundary>
      {view !== "3d" && tool !== "brush" && tool !== "node" && <ZoomControls />}
      {view !== "3d" && <NodeBar />}
      <ErrorBoundary label="The chat">
        <ChatDock />
      </ErrorBoundary>
      <Help />
      <VectorizeDialog />
      <MockupsDialog />
      <FontsDialog />
      <PaletteDialog />
      {view !== "3d" && (
        <ErrorBoundary label="The critique">
          <CritiquePanel />
        </ErrorBoundary>
      )}
      <ErrorBoundary label="Compare">
        <CompareView />
      </ErrorBoundary>
      <CommandPalette />
      <TimelapsePlayer />
      <ExploreDialogs />
      <Presentation />
      <ErrorBoundary label="Stage">
        <Stage />
      </ErrorBoundary>
      {exportOpen && doc && <ExportDialog />}
      <ExportSuccess />
      <Toasts />
      {!doc && <div className="boot">{connected ? "Loading…" : "Connecting to Brusshy…"}</div>}
    </div>
  );
}
