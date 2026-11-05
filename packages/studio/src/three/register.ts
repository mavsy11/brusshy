import { blobToBase64, registerRender3D } from "../lib/requests";
import { frameDocFor } from "../lib/store";
import { render3D, render3DSize } from "./api";

/** Lets the daemon (and so the AI agent) request 3D previews of one version (frame). */
export function register3D() {
  registerRender3D(async (p) => {
    const doc = frameDocFor(p.frame);
    if (!doc) throw new Error("No document open");
    const { width, height } = render3DSize(doc, p.width ?? 1024);
    const blob = await render3D(doc, {
      width,
      height,
      transparent: p.transparent === true,
      azimuth: p.azimuth,
      elevation: p.elevation,
    });
    return { png: await blobToBase64(blob), width, height };
  });
}
