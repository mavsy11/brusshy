import type { ToolKit } from "./kit";
import { registerQuickWinTools } from "./quickwins";
import { registerCanvasTools } from "./canvas";
import { registerStyleTools } from "./style";
import { registerLetteringTools } from "./lettering";
import { registerVectorizeTools } from "./vectorize";
import { registerMockupTools } from "./mockups";
import { registerAnimationTools } from "./animation";
import { registerTypeLabWarpTools } from "./typelab-warp";
import { registerPaletteTools } from "./palette";
import { registerLockupTools } from "./lockup";
import { registerTypeTools } from "./typelab-type";
import { registerRefineTools } from "./refine";
import { registerCritiqueTools } from "./critique";
import { registerConstructTools } from "./construct";
import { registerExploreTools } from "./explore";
import { registerShapeTools } from "./shapes";

/**
 * Feature tool modules register here, one line each, so features can be built
 * independently (e.g. `registerAnimationTools(kit)` from ./animation).
 */
export function registerExtraTools(kit: ToolKit) {
  void kit;
  registerQuickWinTools(kit);
  registerCanvasTools(kit);
  registerStyleTools(kit);
  registerLetteringTools(kit);
  registerVectorizeTools(kit);
  registerMockupTools(kit);
  registerAnimationTools(kit);
  registerTypeLabWarpTools(kit);
  registerPaletteTools(kit);
  registerLockupTools(kit);
  registerTypeTools(kit);
  registerRefineTools(kit);
  registerCritiqueTools(kit);
  registerConstructTools(kit);
  registerExploreTools(kit);
  registerShapeTools(kit);
}
