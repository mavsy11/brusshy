import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "./styles/app.css";
import "./styles/canvas.css";
import "./styles/panels.css";
import "./styles/polish.css";
import { socket, token } from "./lib/socket";
import "./lib/requests";
import { registerExportHandlers } from "./export/register";
import { register3D } from "./three/register";
import { App } from "./App";

// Without its token (a bookmarked or retyped address) the studio can't connect: say how to open it instead of spinning.
function NoToken() {
  return (
    <div className="no-token">
      <h1>Open Brusshy from its link</h1>
      <p>
        For your safety this page needs the private link Brusshy prints when it starts. Run <code>npx brusshy</code> in your project, or ask your AI to
        open the studio.
      </p>
    </div>
  );
}

if (token) {
  registerExportHandlers();
  register3D();
  socket.connect();
}

createRoot(document.getElementById("root")!).render(<StrictMode>{token ? <App /> : <NoToken />}</StrictMode>);
