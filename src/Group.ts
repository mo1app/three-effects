import {
  Group as ThreeGroup,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  Color,
  Vector2,
  Vector3,
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
const _rendererSize = new Vector2();
const _savedClearColor = new Color();

// ─── types ───────────────────────────────────────────────────────────────────

interface NDCBounds {
  nMinX: number; nMaxX: number;
  nMinY: number; nMaxY: number;
  ndcZ: number;
}

// ─── Group ───────────────────────────────────────────────────────────────────

export class Group extends ThreeGroup {
  /** Extra space around the projected bounding box, in NDC units (0 = tight fit). */
  padding = 0;

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
      this._setContentLayer0(true);  // restore normal visibility
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

    // Build mapNode once: placeholder texture + UV remap driven by uniforms.
    // Only .value needs updating when the render target is resized.
    const uvMapped = uv().mul(this._uvMax.sub(this._uvMin)).add(this._uvMin);
    this._mapNode = textureNode(new Texture(), uvMapped);
    this._texMat.colorNode = this._mapNode;

    this._plane = new Mesh(_geo, this._solidMat);
    this._plane.visible = false; // shown only when effectsEnabled = true

    this._plane.onBeforeRender = (_renderer, _scene, camera) => {
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

      this._plane.position.copy(this.worldToLocal(_wCenter));
      this.worldToLocal(_wBL);
      this.worldToLocal(_wBR);
      this.worldToLocal(_wTL);
      this._plane.scale.set(_wBL.distanceTo(_wBR), _wBL.distanceTo(_wTL), 1);

      this._plane.material = this._effectsEnabled
        ? (this._effectsMaterial ?? this._texMat)
        : this._solidMat;
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
    let nMinX = Infinity, nMaxX = -Infinity;
    let nMinY = Infinity, nMaxY = -Infinity;
    let wMinX = Infinity, wMaxX = -Infinity;
    let wMinY = Infinity, wMaxY = -Infinity;
    let wMinZ = Infinity, wMaxZ = -Infinity;
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
          if (_v.x < wMinX) wMinX = _v.x; if (_v.x > wMaxX) wMaxX = _v.x;
          if (_v.y < wMinY) wMinY = _v.y; if (_v.y > wMaxY) wMaxY = _v.y;
          if (_v.z < wMinZ) wMinZ = _v.z; if (_v.z > wMaxZ) wMaxZ = _v.z;
          _v.project(camera);
          if (_v.x < nMinX) nMinX = _v.x; if (_v.x > nMaxX) nMaxX = _v.x;
          if (_v.y < nMinY) nMinY = _v.y; if (_v.y > nMaxY) nMaxY = _v.y;
          hasVerts = true;
        }
      });
    }

    if (!hasVerts) return null;

    nMinX -= this.padding; nMaxX += this.padding;
    nMinY -= this.padding; nMaxY += this.padding;

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

    // Resize render target to match physical viewport pixels
    renderer.getSize(_rendererSize);
    const w = Math.round(_rendererSize.x * renderer.getPixelRatio());
    const h = Math.round(_rendererSize.y * renderer.getPixelRatio());

    if (w !== this._targetW || h !== this._targetH) {
      this._target?.dispose();
      this._target = new RenderTarget(w, h, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        type: HalfFloatType,
      });
      this._targetW = w;
      this._targetH = h;

      // Update the texture reference in all nodes; UV remap uniforms handle the rest.
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

    // Render only this group's layer to the target (plane is layer 0 only → not rendered).
    // Clear to fully transparent so the quad has no background bleed.
    const savedMask = camera.layers.mask;
    const savedTarget = renderer.getRenderTarget();
    const savedBackground = scene.background;
    renderer.getClearColor(_savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();

    scene.background = null;
    camera.layers.mask = 1 << this._layer;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this._target);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(savedTarget);
    renderer.setClearColor(_savedClearColor, savedClearAlpha);
    scene.background = savedBackground;
    camera.layers.mask = savedMask;

    // Restore light layers
    for (const obj of litObjs) obj.layers.disable(this._layer);

    // NDC → UV conversion.
    // X: (ndcX + 1) / 2  — left→right unchanged.
    // Y: (1 − ndcY) / 2  — WebGPU render targets have V=0 at the top of the image.
    //    plane_V=0 (bottom) must sample the bottom of the content (nMinY),
    //    plane_V=1 (top)    must sample the top   of the content (nMaxY),
    //    so uvMin.y uses nMinY and uvMax.y uses nMaxY (note: uvMin.y > uvMax.y).
    this._uvMin.value.set((nMinX + 1) * 0.5, (1 - nMinY) * 0.5);
    this._uvMax.value.set((nMaxX + 1) * 0.5, (1 - nMaxY) * 0.5);
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
