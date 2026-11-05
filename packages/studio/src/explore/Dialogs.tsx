import { ExploreDialog } from "./ExploreDialog";
import { BoardDialog } from "./BoardDialog";
import "./commands";

/** Explorer + reference board dialogs (mounted once in App). */
export function ExploreDialogs() {
  return (
    <>
      <ExploreDialog />
      <BoardDialog />
    </>
  );
}
