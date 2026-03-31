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
  Scene,
  Light,
  Texture,
  Node,
} from "three/webgpu";
import { texture as textureNode, uv, vec2, uniform } from "three/tsl";

// ─── renderer duck-type ───────────────────────────────────────────────────────

/** Duck-typed WebGPU renderer for offscreen passes (avoids tight coupling). */
export interface RendererLike {
  domElement: HTMLCanvasElement;
  getSize(target: Vector2): Vector2;
  getPixelRatio(): number;
  getViewport(target: Vector4): Vector4;
  setViewport(x: number | Vector4, y?: number, width?: number, height?: number): void;
  getRenderTarget(): RenderTarget | null;
  setRenderTarget(target: RenderTarget | null): void;
  getClearColor(target: Color): Color;
  getClearAlpha(): number;
  setClearColor(color: Color | string | number, alpha?: number): void;
  clear(): void;
  render(scene: Scene, camera: Camera): void;
}

// ─── module-level singletons ─────────────────────────────────────────────────

/** Single Three.js layer shared by all GroupRaw instances for effects rendering. */
const SHARED_LAYER = 1;

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
  nMinZ: number;
  nMaxZ: number;
  ndcZ: number;
}

// ─── GroupRaw ────────────────────────────────────────────────────────────────

/**
 * A `THREE.Group` that automatically fits a billboard quad to the projected
 * 2-D screen-space bounding box of its content children.
 *
 * When `effectsEnabled` is `true` the content is rendered to a private,
 * bbox-sized `RenderTarget` each frame and the billboard displays the result.
 * A custom TSL material can be supplied via `effectsMaterial`; it always
 * receives the captured texture through `mapNode`.
 *
 * **Minimal usage**
 * ```ts
 * const group = new GroupRaw();
 * group.effectsEnabled = true;
 * group.effectsMaterial = myTslMaterial; // colorNode uses group.mapNode
 * group.add(myMesh);
 * scene.add(group);
 *
 * // In your render loop — must come before renderer.render():
 * GroupRaw.preRenderEffects(renderer, scene, camera);
 * // or: preRenderEffects(renderer, scene, camera);
 * renderer.render(scene, camera);
 * ```
 */
export class GroupRaw extends ThreeGroup {
  /**
   * Uniform padding applied around the projected bounding box on all sides.
   * Expressed as a fraction of the screen height (NDC-Y units), so the visual
   * margin stays proportional regardless of aspect ratio.
   * @default 0
   */
  padding = 0;

  /**
   * Width of the debug border in screen pixels (distance-independent).
   * Only visible when `debug` is `true`.
   * @default 4
   */
  debugStrokePixels = 4;

  /**
   * Color of the debug border and the default tint for labels added to
   * `debugGroup`. Can be changed at any time.
   * @default 0x00ff66
   */
  debugColor = new Color(0x00ff66);

  private _debug = false;
  private readonly _debugBorder: Mesh[] = [];
  private _debugBorderMat!: MeshBasicNodeMaterial;

  /**
   * A `THREE.Group` anchored to the **top-right corner** of the billboard quad
   * in screen space. Add custom `Object3D`s here for debug annotations.
   *
   * The group's scale is updated every frame so that **1 local unit equals
   * 1 screen pixel**, independent of camera distance. Place children at
   * pixel-sized offsets for predictable screen-space sizing.
   */
  readonly debugGroup = new ThreeGroup();

  /**
   * Show or hide the screen-space debug border around the billboard quad.
   * Border color is driven by `debugColor`; thickness by `debugStrokePixels`.
   */
  get debug(): boolean {
    return this._debug;
  }
  set debug(v: boolean) {
    this._debug = v;
    for (const q of this._debugBorder) q.visible = v;
  }

  private _effectsEnabled = false;
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

  // UV remapping uniforms — updated each frame to handle cases where the
  // content NDC bbox is clamped to the renderer bounds (render target < full bbox).
  // Default (1,-1) / (0,1) is the identity Y-flip for WebGPU render targets.
  private readonly _uvScale  = uniform(new Vector2(1, -1));
  private readonly _uvOffset = uniform(new Vector2(0,  1));

  private _target: RenderTarget | null = null;
  private _targetW = 0;
  private _targetH = 0;
  private readonly _internalCamera = new PerspectiveCamera();
  private readonly _placeholderTex = new Texture();
  private _resizeObserver: ResizeObserver | null = null;

  // Bounds computed in preRenderEffects, consumed in onBeforeRender
  private _ndcBounds: NDCBounds | null = null;

  // Single texture node — Y-flipped UV baked in (WebGPU render targets have
  // V=0 at the top; the plane's V=0 is at the bottom, so we sample 1−v).
  private readonly _mapNode: ReturnType<typeof textureNode>;

  // Extra nodes created via createOffsetSample(); texture ref kept in sync on resize.
  private readonly _secondaryNodes: Array<ReturnType<typeof textureNode>> = [];

  // Optional custom material; replaces _texMat when effectsEnabled
  private _effectsMaterial: MeshBasicNodeMaterial | null = null;

  // Static registry of all effectsEnabled groups
  private static readonly _registry = new Set<GroupRaw>();

  // ── effectsEnabled getter/setter ──────────────────────────────────────────

  /**
   * When `true` the group enters **effects mode**:
   * - Content children are hidden from the main camera (moved to `SHARED_LAYER`).
   * - Every frame (via `preRenderEffects`) the content is rendered into a
   *   private bbox-sized `RenderTarget`.
   * - The billboard quad becomes visible and displays the captured texture,
   *   optionally processed by `effectsMaterial`.
   *
   * When `false` the billboard is hidden and all content renders normally.
   * @default false
   */
  get effectsEnabled(): boolean {
    return this._effectsEnabled;
  }
  set effectsEnabled(v: boolean) {
    this._effectsEnabled = v;
    this._plane.visible = v;
    if (v) {
      GroupRaw._registry.add(this);
      this._setContentLayer(0, false);           // hide from main camera
      this._setContentLayer(SHARED_LAYER, true); // expose to internal camera
    } else {
      GroupRaw._registry.delete(this);
      this._setContentLayer(0, true);             // restore normal visibility
      this._setContentLayer(SHARED_LAYER, false); // remove from effects layer
    }
  }

  /**
   * Optional custom TSL material applied to the billboard quad when
   * `effectsEnabled` is `true`. Falls back to a plain textured material if
   * not set.
   *
   * The material receives the captured render-target texture through
   * `mapNode` (and any nodes created via `createOffsetSample`). It should be
   * created with `transparent: true`, `depthWrite: true`, `side: 2`.
   *
   * @example
   * ```ts
   * const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: 2 });
   * mat.colorNode = group.mapNode; // sample the captured texture
   * group.effectsMaterial = mat;
   * ```
   */
  get effectsMaterial(): MeshBasicNodeMaterial | null {
    return this._effectsMaterial;
  }
  set effectsMaterial(mat: MeshBasicNodeMaterial | null) {
    this._effectsMaterial = mat;
  }

  /**
   * Physical pixel width of the current render target (updated each frame by
   * {@link preRenderEffects}). Returns `0` before the first frame renders.
   *
   * The RT is sized to exactly cover the group's screen footprint at
   * 1 RT-pixel-per-screen-pixel fidelity, so this value tells you how many
   * screen pixels wide the group currently is. Useful for diagnostics or for
   * effects that need to know the current on-screen pixel budget.
   *
   * **Note for `layerStyles` blur-based effects** — `GaussianBlurNode` takes
   * its `directionNode` in **texel (pixel) units** and divides by texture size
   * internally. The correct conversion from a desired pixel width to the
   * direction value is:
   *
   * ```ts
   * directionNode = desiredPixels / (2 + 2 * sigma)
   * ```
   *
   * This depends only on the kernel sigma, not on `renderTargetWidth`.
   */
  get renderTargetWidth(): number {
    return this._targetW;
  }

  /**
   * Physical pixel height of the current render target.
   * See {@link renderTargetWidth} for coordinate-system notes.
   */
  get renderTargetHeight(): number {
    return this._targetH;
  }

  /**
   * A pre-built TSL texture node that samples the group's private render
   * target with Y-axis corrected UVs. Use this as (part of) the `colorNode`
   * of your `effectsMaterial`.
   *
   * The node's underlying texture reference is automatically updated whenever
   * the render target is resized.
   */
  get mapNode(): ReturnType<typeof textureNode> {
    return this._mapNode;
  }

  /**
   * Creates an additional TSL texture node that samples the render target at
   * `flippedUV + uvOffsetNode`. Useful for effects that need to read the
   * texture at multiple offset positions (e.g. drop shadows, blur kernels).
   *
   * The returned node shares the same underlying texture as `mapNode` and is
   * kept in sync when the render target is resized.
   *
   * @param uvOffsetNode - A vec2 TSL node in render-target UV space `[0..1]`.
   * @returns A texture node sampling at the offset UV.
   */
  createOffsetSample(uvOffsetNode: Node): ReturnType<typeof textureNode> {
    const uvRemapped = uv().mul(this._uvScale).add(this._uvOffset);
    const node = textureNode(this._placeholderTex, uvRemapped.add(uvOffsetNode));
    // If a render target is already allocated (effects were previously active),
    // seed the node with the real texture immediately so GaussianBlurNode can
    // read its dimensions on the very first frame — not just on resize.
    if (this._target) node.value = this._target.texture;
    this._secondaryNodes.push(node);
    return node;
  }

  /**
   * Subclasses may override to adjust {@link padding} before bounds are computed
   * (e.g. automatic margin for outer effects). Default is no-op.
   */
  protected _syncAutoPadding(
    _renderer: RendererLike,
    _camera: PerspectiveCamera,
    _fullW: number,
    _fullH: number,
  ): void {}

  /**
   * Subclasses may override to commit deferred GPU work once per frame when
   * the render-target size for this pass is known (see {@link Group}).
   * @default No-op.
   */
  protected _flushDeferredEffectsSync(): void {}

  /**
   * Distance from the camera to the world-space center of the content meshes’
   * axis-aligned bounds (same center used for {@link _computeNDCBounds} `ndcZ`).
   * Used to convert screen-pixel margins to NDC {@link padding} at the content depth.
   */
  protected _getContentWorldCenterDistance(camera: PerspectiveCamera): number | null {
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
          hasVerts = true;
        }
      });
    }

    if (!hasVerts) return null;

    _v.set(
      (wMinX + wMaxX) * 0.5,
      (wMinY + wMaxY) * 0.5,
      (wMinZ + wMaxZ) * 0.5,
    );
    return _v.distanceTo(camera.position);
  }

  // ── constructor ───────────────────────────────────────────────────────────

  constructor() {
    super();

    // Prevent Three.js from overwriting our manually-copied matrixWorld when
    // renderer.render() calls updateMatrixWorld() on cameras with no parent.
    this._internalCamera.matrixWorldAutoUpdate = false;

    // UV remapping: _uvScale / _uvOffset are updated each frame in _renderToTarget
    // to account for both the WebGPU Y-flip and any render-target clamping.
    const uvRemapped = uv().mul(this._uvScale).add(this._uvOffset);
    this._mapNode = textureNode(this._placeholderTex, uvRemapped);
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
      const r = renderer as unknown as RendererLike;
      const dist = _wDebug.distanceTo(camera.position);
      r.getSize(_rendererSize);
      const fovRad = (camera as PerspectiveCamera).fov * (Math.PI / 180);
      const wpp =
        (2 * dist * Math.tan(fovRad * 0.5)) /
        (_rendererSize.y * r.getPixelRatio());

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
   * Renders every registered (i.e. `effectsEnabled = true`) group's content
   * into its private render target for this frame.
   *
   * **Must be called once per frame, before `renderer.render(scene, camera)`.**
   *
   * ```ts
   * renderer.setAnimationLoop(() => {
   *   GroupRaw.preRenderEffects(renderer, scene, camera);
   *   renderer.render(scene, camera);
   * });
   * ```
   *
   * @param renderer - The active WebGPU renderer.
   * @param scene    - The scene being rendered.
   * @param camera   - The main perspective camera.
   */
  static preRenderEffects(
    renderer: RendererLike,
    scene: Scene,
    camera: PerspectiveCamera,
  ): void {
    for (const group of GroupRaw._registry) {
      group._renderToTarget(renderer, scene, camera);
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private _computeNDCBounds(camera: Camera): NDCBounds | null {
    let nMinX = Infinity,  nMaxX = -Infinity;
    let nMinY = Infinity,  nMaxY = -Infinity;
    let nMinZ = Infinity,  nMaxZ = -Infinity;
    let wMinX = Infinity,  wMaxX = -Infinity;
    let wMinY = Infinity,  wMaxY = -Infinity;
    let wMinZ = Infinity,  wMaxZ = -Infinity;
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
          if (_v.z < nMinZ) nMinZ = _v.z;
          if (_v.z > nMaxZ) nMaxZ = _v.z;
          hasVerts = true;
        }
      });
    }

    if (!hasVerts) return null;

    // padding is expressed in NDC-Y units (proportional to screen height).
    // NDC X covers `aspect` times more pixels per unit than NDC Y, so divide
    // the X padding by aspect to keep the visual margin uniform on all sides.
    const aspect = (camera as PerspectiveCamera).aspect;
    nMinX -= this.padding / aspect;
    nMaxX += this.padding / aspect;
    nMinY -= this.padding;
    nMaxY += this.padding;

    _v.set(
      (wMinX + wMaxX) * 0.5,
      (wMinY + wMaxY) * 0.5,
      (wMinZ + wMaxZ) * 0.5,
    ).project(camera);

    return { nMinX, nMaxX, nMinY, nMaxY, nMinZ, nMaxZ, ndcZ: _v.z };
  }

  private _renderToTarget(
    renderer: RendererLike,
    scene: Scene,
    camera: PerspectiveCamera,
  ): void {
    // Lazy resize observer: invalidates the cached target dimensions whenever
    // the canvas changes size, ensuring a 1-frame-max stale period.
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => {
        this._targetW = 0;
        this._targetH = 0;
      });
      this._resizeObserver.observe(renderer.domElement);
    }

    renderer.getSize(_rendererSize);
    const dpr = renderer.getPixelRatio();
    const fullW = Math.round(_rendererSize.x * dpr);
    const fullH = Math.round(_rendererSize.y * dpr);

    this._syncAutoPadding(renderer, camera, fullW, fullH);

    const bounds = this._computeNDCBounds(camera);
    this._ndcBounds = bounds;

    // Frustum cull: hide the billboard if the content bbox is entirely outside
    // NDC space. nMinZ > 1 catches both behind-the-camera and beyond-far-plane
    // cases — perspective projection maps those vertices to NDC Z > 1 because
    // the clip-space W is negative, flipping the divide and corrupting X/Y too.
    const outsideFrustum =
      !bounds ||
      bounds.nMaxX < -1 || bounds.nMinX > 1 ||
      bounds.nMaxY < -1 || bounds.nMinY > 1 ||
      bounds.nMinZ >  1 || bounds.nMaxZ < -1;

    if (outsideFrustum) {
      this._plane.visible = false;
      this._flushDeferredEffectsSync();
      return;
    }
    this._plane.visible = true;

    const { nMinX, nMaxX, nMinY, nMaxY } = bounds;

    // Pixel bounding box of the content (screen Y is top-down), clamped to the
    // renderer bounds so the render target never exceeds fullW × fullH.
    const pxMinX = Math.max(0, Math.floor((nMinX + 1) * 0.5 * fullW));
    const pxMaxX = Math.min(fullW, Math.ceil((nMaxX + 1) * 0.5 * fullW));
    const pxMinY = Math.max(0, Math.floor((1 - nMaxY) * 0.5 * fullH));
    const pxMaxY = Math.min(fullH, Math.ceil((1 - nMinY) * 0.5 * fullH));
    const cropW = Math.max(1, pxMaxX - pxMinX);
    const cropH = Math.max(1, pxMaxY - pxMinY);

    // Derive the visible NDC sub-region from the clamped pixel bounds and update
    // the UV uniforms so the billboard samples the correct portion of the texture.
    // When no clamping occurs, scaleU=1 / scaleV=1 / offsetU=0 / offsetV=1
    // (the identity Y-flip for WebGPU render targets).
    const visNdcMinX = (pxMinX / fullW) * 2 - 1;
    const visNdcMaxX = (pxMaxX / fullW) * 2 - 1;
    const visNdcMinY = 1 - (pxMaxY / fullH) * 2;
    const visNdcMaxY = 1 - (pxMinY / fullH) * 2;
    const visNdcW = visNdcMaxX - visNdcMinX;
    const visNdcH = visNdcMaxY - visNdcMinY;
    const fullNdcW = nMaxX - nMinX;
    const fullNdcH = nMaxY - nMinY;
    this._uvScale.value.set(
      fullNdcW / visNdcW,           // scaleU: stretches U across the full bbox
      -(fullNdcH / visNdcH),        // scaleV: negated for Y-flip
    );
    this._uvOffset.value.set(
      (nMinX - visNdcMinX) / visNdcW,           // offsetU
      (visNdcMaxY - nMinY) / visNdcH,           // offsetV (Y-flipped)
    );

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

    this._flushDeferredEffectsSync();

    // Hide every other effectsEnabled group's content from SHARED_LAYER so
    // this group renders in isolation. Restored after the offscreen pass.
    for (const other of GroupRaw._registry) {
      if (other !== this) other._setContentLayer(SHARED_LAYER, false);
    }

    // Temporarily grant SHARED_LAYER to scene lights so they illuminate content.
    const litObjs: Object3D[] = [];
    scene.traverse((obj: Object3D) => {
      if (obj instanceof Light) {
        litObjs.push(obj);
        obj.layers.enable(SHARED_LAYER);
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
    ic.layers.mask = 1 << SHARED_LAYER;

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

    // Restore lights and sibling groups
    for (const obj of litObjs) obj.layers.disable(SHARED_LAYER);
    for (const other of GroupRaw._registry) {
      if (other !== this) other._setContentLayer(SHARED_LAYER, true);
    }
  }

  // ── overrides ─────────────────────────────────────────────────────────────

  /** Toggle a layer on all content children (not the plane). */
  private _setContentLayer(layer: number, enabled: boolean): void {
    for (const child of this.children) {
      if (child === this._plane) continue;
      child.traverse((node) => {
        if (enabled) node.layers.enable(layer);
        else node.layers.disable(layer);
      });
    }
  }

  /**
   * Adds one or more objects to this group. If `effectsEnabled` is already
   * `true`, the objects are immediately placed on `SHARED_LAYER` and removed
   * from layer 0 so they are captured by `preRenderEffects` and hidden from
   * the main camera.
   */
  override add(...objects: Object3D[]): this {
    super.add(...objects);
    for (const obj of objects) {
      if (obj === this._plane) continue;
      if (this._effectsEnabled) {
        obj.traverse((child) => {
          child.layers.disable(0);
          child.layers.enable(SHARED_LAYER);
        });
      }
    }
    return this;
  }

  /**
   * Removes one or more objects from this group. If `effectsEnabled` is
   * `true`, the removed objects are restored to layer 0 and removed from
   * `SHARED_LAYER` so they become visible to the main camera again.
   */
  override remove(...objects: Object3D[]): this {
    super.remove(...objects);
    for (const obj of objects) {
      if (obj === this._plane) continue;
      obj.traverse((child) => {
        child.layers.enable(0);
        child.layers.disable(SHARED_LAYER);
      });
    }
    return this;
  }

  /**
   * Releases all GPU resources owned by this group (render target, materials,
   * placeholder texture) and disconnects the canvas resize observer.
   *
   * Call this when the group is permanently removed from the scene. Children
   * added via `add()` are **not** disposed — the caller is responsible for
   * cleaning up their own geometries and materials.
   */
  dispose(): void {
    GroupRaw._registry.delete(this);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._target?.dispose();
    this._target = null;
    this._placeholderTex.dispose();
    this._solidMat.dispose();
    this._texMat.dispose();
    this._debugBorderMat.dispose();
  }
}

/**
 * Ergonomic alias for {@link GroupRaw.preRenderEffects} — same implementation.
 */
export function preRenderEffects(
  renderer: RendererLike,
  scene: Scene,
  camera: PerspectiveCamera,
): void {
  GroupRaw.preRenderEffects(renderer, scene, camera);
}
