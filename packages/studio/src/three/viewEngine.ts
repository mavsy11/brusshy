import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DocT, SceneT } from "@brusshy/core";
import { Stage, type BuildResult } from "./stage";

/** On-screen renderer + orbit controls around a Stage. Renders on demand. */
export class ViewEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly stage: Stage;
  readonly controls: OrbitControls;
  private host: HTMLElement;
  private ro: ResizeObserver;
  private raf = 0;
  private dirty = true;
  private width = 1;
  private height = 1;
  private cam: SceneT["camera"] | null = null;
  lost = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.className = "v3d-canvas";
    host.appendChild(canvas);
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });

    this.stage = new Stage(this.renderer, { samples: 4 });
    // Leave room for the floating control bar.
    this.stage.frameMargin = 1.45;
    this.controls = new OrbitControls(this.stage.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.7;
    this.controls.enablePan = false;
    this.controls.addEventListener("change", () => (this.dirty = true));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.controls.update()) this.dirty = true;
      if (this.dirty && !this.lost) {
        this.dirty = false;
        this.stage.render();
      }
    };
    this.raf = requestAnimationFrame(loop);
    if (import.meta.env.DEV) (window as unknown as { __v3d?: ViewEngine }).__v3d = this;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.stage.setSize(w, h, Math.min(window.devicePixelRatio || 1, 2), true);
    this.updateLimits();
    // setSize clears the canvas: redraw now to avoid a blank frame.
    if (!this.lost && this.stage.settings) this.stage.render();
    this.dirty = false;
  }

  private updateLimits() {
    const fit = this.stage.fitDistance(this.width / this.height);
    this.controls.minDistance = fit * 0.35;
    this.controls.maxDistance = fit * 3.5;
  }

  setDoc(doc: DocT, override: Partial<SceneT> = {}): BuildResult {
    const res = this.stage.setDoc(doc, override);
    const cam = this.stage.settings!.camera;
    if (!this.cam || JSON.stringify(cam) !== JSON.stringify(this.cam)) this.applyCamera(cam);
    this.updateLimits();
    this.dirty = true;
    return res;
  }

  /** Move the orbit camera to the saved camera. */
  applyCamera(cam: SceneT["camera"]) {
    this.cam = { ...cam };
    this.stage.placeCamera(cam.azimuth, cam.elevation, cam.distance, cam.fov, this.width / this.height);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.dirty = true;
  }

  preview(o: { depth?: number; bloom?: number }) {
    this.stage.preview(o);
    this.dirty = true;
  }

  resetCamera() {
    if (this.cam) this.applyCamera(this.cam);
  }

  readCamera() {
    return this.stage.readCamera(this.controls.target);
  }

  invalidate() {
    this.dirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.stage.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
