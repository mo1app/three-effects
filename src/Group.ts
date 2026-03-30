import {
  Group as ThreeGroup,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Color,
  Vector2,
  Vector3,
  Vector4,
  RenderTarget,
  HalfFloatType,
  LinearFilter,
  Object3D,
  Camera,
  Texture,
} from "three/webgpu";
import { texture as textureNode, uv, uniform } from "three/tsl";

// ─── module-level singletons ─────────────────────────────────────────────────

let _layerCounter = 1;

const _geo = new PlaneGeometry(1, 1);

const _v = new Vector3();
const _wBL = new Vector3();
const _wBR = new Vector3();
const _wTL = new Vector3();
const _wCenter = new Vector3();
const _wDebug = new Vector3();
const _rendererSize = new Vector2();
const _savedClearColor = new Color();
const _savedViewport = new Vector4();

// ─── types ───────────────────────────────────────────────────────────────────

interface NDCBounds {
  nMinX: number;
  nMaxX: number;
  nMinY: number;
  nMaxY: number;
  ndcZ: number;
}

// ─── Group ───────────────────────────────────────────────────────────────────

export class Group extends ThreeGroup {
  /** Extra space around the projected bounding box, in NDC units (0 = tight fit). */
  padding = 0;

  /** Stroke width of the debug border in screen pixels. */
  debugStrokePixels = 4;

  /** Color of the debug border. */
  debugColor = new Color(0x00ff66);

  private _debug = false;
  private readonly _debugBorder: Mesh[] = [];
  private _debugBorderMat!: MeshBasicNodeMaterial;

  /** Attach custom debug objects here; anchored to the top-right corner of the billboard. */
  readonly debugGroup = new ThreeGroup();

  get debug(): boolean {
    return this._debug;
  }
  set debug(v: boolean) {
    this._debug = v;
    for (const q of this._debugBorder) q.visible = v;
  }

  private _effectsEnabled = false;
  private readonly _layer: number;
  private readonly _plane: Mesh;

  private readonly _solidMat = new MeshBasicNodeMaterial({
    color: new Color(0xff2020),
    side: 2,
    depthWrite: false,
  });
  private readonly _texMat = new MeshBasicNodeMaterial({
    side: 2,
    depthWrite: true,
    transparent: true,
  });

  private readonly _uvMin = uniform(new Vector2(0, 0));
  private readonly _uvMax = uniform(new Vector2(1, 1));

  private _target: RenderTarget | null = null;
  private _targetW = 0;
  private _targetH = 0;
  private readonly _internalCamera = new PerspectiveCamera();

  // Bounds computed in preRenderEffects, consumed in onBeforeRender
  private _ndcBounds: NDCBounds | null = null;

  // Single texture node: mutable .value + UV-remap baked in. Set once, reused forever.
  private readonly _mapNode: ReturnType<typeof textureNode>;

  // Extra nodes created via createOffsetSample(); kept in sync with _mapNode on resize.
  private readonly _secondaryNodes: Array<ReturnType<typeof textureNode>> = [];

  // Optional custom material; replaces _texMat when effectsEnabled
  private _effectsMaterial: MeshBasicNodeMaterial | null = null;

  // Static registry of all effectsEnabled groups
  private static readonly _registry = new Set<Group>();

  // ── effectsEnabled getter/setter ──────────────────────────────────────────

  get effectsEnabled(): boolean {
    return this._effectsEnabled;
  }
  set effectsEnabled(v: boolean) {
    this._effectsEnabled = v;
    this._plane.visible = v;
    if (v) {
      Group._registry.add(this);
      this._setContentLayer0(false); // hide from main camera; captured via _layer
    } else {
      Group._registry.delete(this);
      this._setContentLayer0(true); // restore normal visibility
    }
  }

  /**
   * Optional custom TSL material for the billboard.
   * Use `this.mapNode` in its `colorNode` to sample the captured texture.
   * Should have `transparent: true`, `depthWrite: true`, `side: 2`.
   */
  get effectsMaterial(): MeshBasicNodeMaterial | null {
    return this._effectsMaterial;
  }
  set effectsMaterial(mat: MeshBasicNodeMaterial | null) {
    this._effectsMaterial = mat;
  }

  /** Pre-cropped texture node — use this in a custom `effectsMaterial.colorNode`. */
  get mapNode(): ReturnType<typeof textureNode> {
    return this._mapNode;
  }

  /**
   * Creates a second texture node that samples the render target at
   * (remappedUV + uvOffsetNode), staying in sync with the primary `mapNode`.
   * `uvOffsetNode` is in render-target UV space [0..1].
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createOffsetSample(uvOffsetNode: any): ReturnType<typeof textureNode> {
    const uvMapped = uv()
      .mul(this._uvMax.sub(this._uvMin))
      .add(this._uvMin)
      .add(uvOffsetNode);
    const node = textureNode(this._mapNode.value, uvMapped);
    this._secondaryNodes.push(node);
    return node;
  }

  // ── constructor ───────────────────────────────────────────────────────────

  constructor() {
    super();

    this._layer = _layerCounter++;
    if (_layerCounter > 31) _layerCounter = 1;

    // Prevent Three.js from overwriting our manually-copied matrixWorld when
    // renderer.render() calls updateMatrixWorld() on cameras with no parent.
    this._internalCamera.matrixWorldAutoUpdate = false;

    // Build mapNode once: placeholder texture + UV remap driven by uniforms.
    // Only .value needs updating when the render target is resized.
    const uvMapped = uv().mul(this._uvMax.sub(this._uvMin)).add(this._uvMin);
    this._mapNode = textureNode(new Texture(), uvMapped);
    this._texMat.colorNode = this._mapNode;

    this._plane = new Mesh(_geo, this._solidMat);
    this._plane.visible = false; // shown only when effectsEnabled = true

    // 4 thin quads forming a border frame — thickness driven per-frame in onBeforeRender.
    this._debugBorderMat = new MeshBasicNodeMaterial({
      color: this.debugColor,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: 2,
    });
    for (let i = 0; i < 4; i++) {
      const q = new Mesh(_geo, this._debugBorderMat);
      q.visible = false;
      q.renderOrder = 999;
      q.frustumCulled = false;
      this._debugBorder.push(q);
      this._plane.add(q);
    }

    this.debugGroup.position.set(0.5, 0.5, 0.002);
    this.debugGroup.frustumCulled = false;
    this._plane.add(this.debugGroup);

    this._plane.onBeforeRender = (renderer, _scene, camera) => {
      // Billboard
      this._plane.quaternion.copy(camera.quaternion);

      // For effects groups, use the bounds already computed in preRenderEffects.
      // For plain groups, compute fresh here.
      const bounds = this._effectsEnabled
        ? this._ndcBounds
        : this._computeNDCBounds(camera);

      if (!bounds) return;

      const { nMinX, nMaxX, nMinY, nMaxY, ndcZ } = bounds;

      _wBL.set(nMinX, nMinY, ndcZ).unproject(camera);
      _wBR.set(nMaxX, nMinY, ndcZ).unproject(camera);
      _wTL.set(nMinX, nMaxY, ndcZ).unproject(camera);
      _wCenter
        .set((nMinX + nMaxX) * 0.5, (nMinY + nMaxY) * 0.5, ndcZ)
        .unproject(camera);

      // Always save world center — needed for wpp whether or not debug is on
      _wDebug.copy(_wCenter);

      this._plane.position.copy(this.worldToLocal(_wCenter));
      this.worldToLocal(_wBL);
      this.worldToLocal(_wBR);
      this.worldToLocal(_wTL);
      this._plane.scale.set(_wBL.distanceTo(_wBR), _wBL.distanceTo(_wTL), 1);

      this._plane.material = this._effectsEnabled
        ? (this._effectsMaterial ?? this._texMat)
        : this._solidMat;

      // World units per screen pixel at the plane's depth
      const dist = _wDebug.distanceTo(camera.position);
      (renderer as any).getSize(_rendererSize);
      const fovRad = (camera as any).fov * (Math.PI / 180);
      const wpp =
        (2 * dist * Math.tan(fovRad * 0.5)) /
        (_rendererSize.y * (renderer as any).getPixelRatio());

      // Scale debugGroup so 1 local unit = 1 screen pixel, distance-independent
      this.debugGroup.scale.set(
        wpp / this._plane.scale.x,
        wpp / this._plane.scale.y,
        1,
      );

      // Update debug border quads to a constant screen-space stroke width
      if (this._debug && this._debugBorder.length === 4) {
        (this._debugBorderMat.color as Color).copy(this.debugColor);
        const stroke = this.debugStrokePixels * wpp;

        // Convert world stroke to plane-local fractions
        const lx = stroke / this._plane.scale.x;
        const ly = stroke / this._plane.scale.y;

        const [bottom, top, left, right] = this._debugBorder;
        bottom.scale.set(1, ly, 1);
        bottom.position.set(0, -0.5 + ly * 0.5, 0.001);
        top.scale.set(1, ly, 1);
        top.position.set(0, 0.5 - ly * 0.5, 0.001);
        left.scale.set(lx, 1 - ly * 2, 1);
        left.position.set(-0.5 + lx * 0.5, 0, 0.001);
        right.scale.set(lx, 1 - ly * 2, 1);
        right.position.set(0.5 - lx * 0.5, 0, 0.001);
      }
    };

    this.add(this._plane);
  }

  // ── static API ────────────────────────────────────────────────────────────

  /**
   * Call once per frame **before** `renderer.render(scene, camera)`.
   * Renders each effectsEnabled group's content to its private render target.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static preRenderEffects(renderer: any, scene: any, camera: any): void {
    for (const group of Group._registry) {
      group._renderToTarget(renderer, scene, camera);
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private _computeNDCBounds(camera: Camera): NDCBounds | null {
    let nMinX = Infinity,
      nMaxX = -Infinity;
    let nMinY = Infinity,
      nMaxY = -Infinity;
    let wMinX = Infinity,
      wMaxX = -Infinity;
    let wMinY = Infinity,
      wMaxY = -Infinity;
    let wMinZ = Infinity,
      wMaxZ = -Infinity;
    let hasVerts = false;

    for (const child of this.children) {
      if (child === this._plane) continue;
      child.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const pos = (node as Mesh).geometry?.attributes?.position;
        if (!pos) return;
        node.updateWorldMatrix(true, false);
        for (let i = 0, l = pos.count; i < l; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
          if (_v.x < wMinX) wMinX = _v.x;
          if (_v.x > wMaxX) wMaxX = _v.x;
          if (_v.y < wMinY) wMinY = _v.y;
          if (_v.y > wMaxY) wMaxY = _v.y;
          if (_v.z < wMinZ) wMinZ = _v.z;
          if (_v.z > wMaxZ) wMaxZ = _v.z;
          _v.project(camera);
          if (_v.x < nMinX) nMinX = _v.x;
          if (_v.x > nMaxX) nMaxX = _v.x;
          if (_v.y < nMinY) nMinY = _v.y;
          if (_v.y > nMaxY) nMaxY = _v.y;
          hasVerts = true;
        }
      });
    }

    if (!hasVerts) return null;

    nMinX -= this.padding;
    nMaxX += this.padding;
    nMinY -= this.padding;
    nMaxY += this.padding;

    _v.set(
      (wMinX + wMaxX) * 0.5,
      (wMinY + wMaxY) * 0.5,
      (wMinZ + wMaxZ) * 0.5,
    ).project(camera);

    return { nMinX, nMaxX, nMinY, nMaxY, ndcZ: _v.z };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _renderToTarget(renderer: any, scene: any, camera: any): void {
    const bounds = this._computeNDCBounds(camera);
    this._ndcBounds = bounds;
    if (!bounds) return;

    const { nMinX, nMaxX, nMinY, nMaxY } = bounds;

    // Full physical pixel dimensions of the renderer
    renderer.getSize(_rendererSize);
    const dpr = renderer.getPixelRatio();
    const fullW = Math.round(_rendererSize.x * dpr);
    const fullH = Math.round(_rendererSize.y * dpr);

    // Pixel bounding box of the content (screen Y is top-down)
    const pxMinX = Math.floor((nMinX + 1) * 0.5 * fullW);
    const pxMaxX = Math.ceil((nMaxX + 1) * 0.5 * fullW);
    const pxMinY = Math.floor((1 - nMaxY) * 0.5 * fullH);
    const pxMaxY = Math.ceil((1 - nMinY) * 0.5 * fullH);
    const cropW = Math.max(1, pxMaxX - pxMinX);
    const cropH = Math.max(1, pxMaxY - pxMinY);

    // Allocate a cropped render target sized to the bbox — not full-screen
    if (cropW !== this._targetW || cropH !== this._targetH) {
      this._target?.dispose();
      this._target = new RenderTarget(cropW, cropH, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        type: HalfFloatType,
      });
      this._targetW = cropW;
      this._targetH = cropH;

      this._mapNode.value = this._target.texture;
      for (const n of this._secondaryNodes) n.value = this._target.texture;
    }

    // Temporarily grant our layer to scene lights so they illuminate content
    const litObjs: Object3D[] = [];
    scene.traverse((obj: Object3D) => {
      if ((obj as any).isLight) {
        litObjs.push(obj);
        obj.layers.enable(this._layer);
      }
    });

    // Sync the internal camera from the main camera so the scene renders from
    // the same viewpoint. Main camera is never modified — no restore needed.
    const ic = this._internalCamera;
    ic.fov    = camera.fov;
    ic.aspect = camera.aspect;
    ic.near   = camera.near;
    ic.far    = camera.far;
    ic.zoom   = camera.zoom ?? 1;
    ic.view   = camera.view ? { ...camera.view } : null;
    ic.matrixWorld.copy(camera.matrixWorld);
    ic.matrixWorldInverse.copy(camera.matrixWorldInverse);
    // setViewOffset zooms the projection into the bbox pixel region,
    // filling the cropW×cropH target at full resolution.
    ic.setViewOffset(fullW, fullH, pxMinX, pxMinY, cropW, cropH);
    ic.layers.mask = 1 << this._layer;

    const savedTarget = renderer.getRenderTarget();
    const savedBackground = scene.background;
    renderer.getClearColor(_savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();

    scene.background = null;
    renderer.setClearColor(0x000000, 0);

    // renderer.setViewport takes LOGICAL pixels (Three.js multiplies by
    // pixelRatio internally). Save the current logical viewport so we can
    // restore it exactly after the offscreen pass.
    renderer.getViewport(_savedViewport);
    renderer.setViewport(0, 0, cropW / dpr, cropH / dpr);

    renderer.setRenderTarget(this._target);
    renderer.clear();
    renderer.render(scene, ic);

    // Restore renderer state
    renderer.setRenderTarget(savedTarget);
    renderer.setViewport(_savedViewport);
    renderer.setClearColor(_savedClearColor, savedClearAlpha);
    scene.background = savedBackground;

    // Restore light layers
    for (const obj of litObjs) obj.layers.disable(this._layer);

    // Flip UV Y: WebGPU texture V=0 is the top of the image (NDC Y=+1),
    // but the plane's UV V=0 is the bottom — so we sample (u, 1-v).
    this._uvMin.value.set(0, 1);
    this._uvMax.value.set(1, 0);
  }

  // ── overrides ─────────────────────────────────────────────────────────────

  /** Toggle layer 0 on all content children (not the plane). */
  private _setContentLayer0(enabled: boolean): void {
    for (const child of this.children) {
      if (child === this._plane) continue;
      child.traverse((node) => {
        if (enabled) node.layers.enable(0);
        else node.layers.disable(0);
      });
    }
  }

  /** Enable the group's private render layer on newly added content. */
  override add(...objects: Object3D[]): this {
    super.add(...objects);
    for (const obj of objects) {
      if (obj === this._plane) continue;
      obj.traverse((child) => {
        child.layers.enable(this._layer);
        // If effects are already active, keep content off layer 0.
        if (this._effectsEnabled) child.layers.disable(0);
      });
    }
    return this;
  }

  /** Release GPU resources. Call when the group is permanently removed. */
  dispose(): void {
    Group._registry.delete(this);
    this._target?.dispose();
    this._target = null;
    this._solidMat.dispose();
    this._texMat.dispose();
  }
}
