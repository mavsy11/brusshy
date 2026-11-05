import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";

/**
 * Baked contact shadow (three.js "contact shadows" technique): an orthographic
 * camera looks up from the floor, renders the logo's depth as darkness, blurs
 * it twice, and a floor plane shows the result. Soft, cheap, and works on
 * transparent backgrounds.
 */
export class ContactShadow {
  readonly group = new THREE.Group();
  private rt: THREE.WebGLRenderTarget;
  private rtBlur: THREE.WebGLRenderTarget;
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private blurPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private cam: THREE.OrthographicCamera;
  private depthMat: THREE.MeshDepthMaterial;
  private hBlur: THREE.ShaderMaterial;
  private vBlur: THREE.ShaderMaterial;
  private darkness = { value: 1 };
  blur = 3.2;

  constructor(size = 512) {
    const opts = { type: THREE.HalfFloatType } as const;
    this.rt = new THREE.WebGLRenderTarget(size, size, opts);
    this.rt.texture.generateMipmaps = false;
    this.rtBlur = new THREE.WebGLRenderTarget(size, size, opts);
    this.rtBlur.texture.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    this.plane = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.6 }),
    );
    this.plane.renderOrder = 1;
    this.plane.scale.y = -1;
    this.group.add(this.plane);

    this.blurPlane = new THREE.Mesh(geo, new THREE.ShaderMaterial());
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);

    this.cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    this.cam.rotation.x = Math.PI / 2;
    this.group.add(this.cam);

    this.depthMat = new THREE.MeshDepthMaterial();
    this.depthMat.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = this.darkness;
      shader.fragmentShader =
        "uniform float darkness;\n" +
        shader.fragmentShader.replace(
          "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
          "gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.6 ) * darkness );",
        );
    };
    this.depthMat.depthTest = false;
    this.depthMat.depthWrite = false;

    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.hBlur.depthTest = false;
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this.vBlur.depthTest = false;
  }

  /** Place the floor `y`, covering `width` × `width`, capturing `height` above it. */
  layout(y: number, width: number, height: number) {
    this.group.position.set(0, y, 0);
    this.plane.scale.set(width, -1, width);
    this.blurPlane.scale.set(width, 1, width);
    this.cam.left = -width / 2;
    this.cam.right = width / 2;
    this.cam.top = width / 2;
    this.cam.bottom = -width / 2;
    this.cam.near = 0;
    this.cam.far = height;
    this.cam.updateProjectionMatrix();
  }

  set opacity(v: number) {
    this.plane.material.opacity = v;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible() {
    return this.group.visible;
  }

  private blurPass(r: THREE.WebGLRenderer, amount: number) {
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse!.value = this.rt.texture;
    this.hBlur.uniforms.h!.value = amount / 256;
    r.setRenderTarget(this.rtBlur);
    r.render(this.blurPlane, this.cam);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse!.value = this.rtBlur.texture;
    this.vBlur.uniforms.v!.value = amount / 256;
    r.setRenderTarget(this.rt);
    r.render(this.blurPlane, this.cam);
    this.blurPlane.visible = false;
  }

  /** Re-bake the shadow (call when the logo or its pose changes). */
  update(r: THREE.WebGLRenderer, scene: THREE.Scene, darkness = 1.15) {
    if (!this.group.visible) return;
    this.darkness.value = darkness;
    const bg = scene.background;
    const env = scene.environment;
    const prevTarget = r.getRenderTarget();
    const clearAlpha = r.getClearAlpha();
    const clearColor = r.getClearColor(new THREE.Color());
    const toneMapping = r.toneMapping;
    scene.background = null;
    scene.environment = null;
    scene.overrideMaterial = this.depthMat;
    this.plane.visible = false;
    r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.cam);
    scene.overrideMaterial = null;
    this.blurPass(r, this.blur);
    this.blurPass(r, this.blur * 0.45);
    this.plane.visible = true;
    scene.background = bg;
    scene.environment = env;
    r.toneMapping = toneMapping;
    r.setClearColor(clearColor, clearAlpha);
    r.setRenderTarget(prevTarget);
  }

  dispose() {
    this.rt.dispose();
    this.rtBlur.dispose();
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.depthMat.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
  }
}
