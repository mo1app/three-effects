/**
 * Jump Flooding Algorithm (JFA) stroke — two-pass-per-iteration seed propagation
 * that builds a true Euclidean distance field, giving clean, sharp stroke edges with
 * proper circular arcs at convex corners (matching Photoshop's stroke rendering).
 *
 * Architecture
 * ─────────────
 *  • Seed pass   : renders a fullscreen quad to `_seedRT`.
 *                  Each pixel stores its own UV coordinate if it is an alpha
 *                  boundary seed; otherwise stores a "no seed" sentinel.
 *  • JFA passes  : `MAX_JFA_PASSES` (=10) ping-pong passes between `_pingRT`
 *                  and `_pongRT`.  Step sizes halve each pass: N/2, N/4, … 1.
 *                  Each pass writes the nearest-seed UV for every pixel.
 *  • Stroke mask : computed inline in the effects-material fragment shader by
 *                  reading the final JFA texture, computing the Euclidean pixel
 *                  distance to the nearest seed, and thresholding against the
 *                  stroke radius.
 *
 * Coordinate space
 * ─────────────────
 * All JFA passes operate in **raw RT texcoord** space (u ∈ [0,1], v=0 top).
 * In `setup()` the stroke mask uses `textureNode.uvNode` (= Group's corrected UV,
 * which equals raw RT texcoord) as the "current pixel" position so that the
 * distance computation is consistent with the stored seed positions.
 * The Euclidean distance is Y-flip invariant, so this scheme is always correct.
 */

import {
  HalfFloatType,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RenderTarget,
  RendererUtils,
  TempNode,
  Vector2,
} from "three/webgpu";
import {
  Fn,
  If,
  convertToTexture,
  float,
  length,
  nodeObject,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

/** Number of JFA passes — covers textures up to 1024 × 1024 px exactly. */
const MAX_JFA_PASSES = 10;

/** Shared quad mesh — one instance suffices; passes are never concurrent. */
const _quadMesh = /* @__PURE__ */ new QuadMesh();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rendererState: any;

/** 8-connected neighbor offsets used in every JFA pass. */
const OFFSETS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

class JFAStrokeNode extends TempNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textureNode: any;
  /**
   * Stroke radius in **screen pixels** (updated via a uniform each frame when
   * the UI slider moves).  The JFA distance field is also in pixels, so this
   * comparison is direct and correct.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  radiusPxNode: any;
  /**
   * `false` → **outside** stroke (seeds = alpha > 0.5 pixels).
   * `true`  → **inside** stroke  (seeds = alpha < 0.5 pixels).
   */
  seedInvert: boolean;

  private readonly _texSize = uniform(new Vector2());
  private readonly _invSize = uniform(new Vector2());
  /** Current JFA step size in pixels (updated each pass). */
  private readonly _stepSize = uniform(1.0);

  private readonly _seedRT: RenderTarget;
  private readonly _pingRT: RenderTarget;
  private readonly _pongRT: RenderTarget;

  /**
   * TextureNode that points to whichever ping/pong RT holds the current JFA
   * input.  Its `.value` is swapped between passes in `updateBefore`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _jfaInputTex: any;

  /**
   * TextureNode for the *output* of the full JFA run.  Updated at the end of
   * `updateBefore` to point to whichever RT holds the final result.
   * Its `uvNode` is set to the Group's corrected UV so it is sampled correctly
   * in the effects-material fragment shader.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _outputTexNode: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _seedMaterial: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _jfaMaterial: any = null;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    textureNode: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    radiusPxNode: any,
    seedInvert = false,
  ) {
    super("vec4");
    this.textureNode = textureNode;
    this.radiusPxNode = radiusPxNode;
    this.seedInvert = seedInvert;

    const rtOpts = { depthBuffer: false, type: HalfFloatType };
    this._seedRT = new RenderTarget(1, 1, rtOpts);
    this._pingRT = new RenderTarget(1, 1, rtOpts);
    this._pongRT = new RenderTarget(1, 1, rtOpts);

    // Internal ping-pong texture for JFA passes (value updated each pass).
    this._jfaInputTex = texture(this._seedRT.texture);

    // Output texture: after MAX_JFA_PASSES=10 (even number of swaps starting
    // from _seedRT), the final result lands in _pongRT.
    this._outputTexNode = texture(this._pongRT.texture);
    // Sample the JFA result with the Group's corrected UV so it aligns with
    // the effects-material's fragment UV space.
    this._outputTexNode.uvNode = textureNode.uvNode;

    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  setSize(width: number, height: number): void {
    this._invSize.value.set(1 / width, 1 / height);
    this._texSize.value.set(width, height);
    this._seedRT.setSize(width, height);
    this._pingRT.setSize(width, height);
    this._pongRT.setSize(width, height);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBefore(frame: any): void {
    const { renderer } = frame;
    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

    const map = this.textureNode.value as { image: { width: number; height: number } };
    const W = map.image.width;
    const H = map.image.height;
    this.setSize(W, H);

    // ── 1. Seed pass ──────────────────────────────────────────────────────
    _quadMesh.material = this._seedMaterial;
    renderer.setRenderTarget(this._seedRT);
    _quadMesh.render(renderer);

    // ── 2. JFA passes (ping-pong) ─────────────────────────────────────────
    // Step sequence: maxDim/2, maxDim/4, …, 1  (MAX_JFA_PASSES total)
    // With MAX_JFA_PASSES=10 the final write goes to _pongRT (see analysis in
    // the class docblock), so _outputTexNode can always point there.
    _quadMesh.material = this._jfaMaterial;

    let readRT = this._seedRT;
    let writeRT = this._pingRT;
    const maxDim = Math.max(W, H);

    for (let i = 0; i < MAX_JFA_PASSES; i++) {
      this._stepSize.value = Math.max(1, Math.round(maxDim / Math.pow(2, i + 1)));
      this._jfaInputTex.value = readRT.texture;
      renderer.setRenderTarget(writeRT);
      _quadMesh.render(renderer);
      const tmp = readRT;
      readRT = writeRT;
      writeRT = tmp;
    }

    // After 10 passes readRT holds the final result.  Update the output node.
    this._outputTexNode.value = readRT.texture;

    RendererUtils.restoreRendererState(renderer, _rendererState);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(builder: any): any {
    const textureNode = this.textureNode;
    const jfaInputTex = this._jfaInputTex;
    const invSize = this._invSize;
    const stepSize = this._stepSize;
    const seedInvert = this.seedInvert;

    // ── Seed pass shader ──────────────────────────────────────────────────
    // Fragment at raw quad UV (u, v):
    //   • samples the source with the EXPLICIT raw UV, overriding the Group's
    //     built-in corrected UV (textureNode.sample(uv) pattern).
    //   • stores (u, v, 1, 1) if it is a seed, (0, 0, 0, 1) otherwise.
    //
    // Using the raw UV is intentional: the seed coordinates and all JFA pass
    // coordinates live in the same raw RT-texcoord space, so distance
    // comparisons are consistent throughout.
    const seedFn = Fn(() => {
      const uvNode = uv();
      // Explicit UV overrides textureNode's built-in corrected uvNode.
      const alpha = textureNode.sample(uvNode).a;
      const result = vec4(float(0), float(0), float(0), float(1)).toVar();
      const isSeed = seedInvert
        ? alpha.lessThan(float(0.5))
        : alpha.greaterThan(float(0.5));
      If(isSeed, () => {
        result.assign(vec4(uvNode.x, uvNode.y, float(1), float(1)));
      });
      return result;
    });

    const seedMat: NodeMaterial =
      this._seedMaterial ?? (this._seedMaterial = new NodeMaterial());
    seedMat.fragmentNode = seedFn().context(builder.getSharedContext());
    seedMat.name = "JFA_seed";
    seedMat.needsUpdate = true;

    // ── JFA pass shader ───────────────────────────────────────────────────
    // For each pixel, examine 8 neighbours at ±stepSize pixels.
    // The pixel with the smallest UV-space distance to a valid seed wins.
    // UV-space distance is sufficient for seed selection (scale cancels out
    // when comparing; actual pixel distance is only needed for the final mask).
    const jfaFn = Fn(() => {
      const uvNode = uv();
      const current = vec4(jfaInputTex.sample(uvNode)).toVar();
      const bestSeed = vec2(current.x, current.y).toVar();
      const bestValid = current.z.toVar(); // 0 = no seed, 1 = valid
      // Use 2.0 as "infinity" — max possible UV distance is sqrt(2) ≈ 1.41.
      const bestDist = float(2).toVar();

      If(current.z.greaterThan(float(0.5)), () => {
        bestDist.assign(length(uvNode.sub(vec2(current.x, current.y))));
      });

      for (const [dx, dy] of OFFSETS) {
        const nUV = uvNode.add(
          vec2(
            float(dx).mul(stepSize).mul(invSize.x),
            float(dy).mul(stepSize).mul(invSize.y),
          ),
        );
        const n = vec4(jfaInputTex.sample(nUV)).toVar();
        If(n.z.greaterThan(float(0.5)), () => {
          const nDist = length(uvNode.sub(vec2(n.x, n.y)));
          If(nDist.lessThan(bestDist), () => {
            bestSeed.assign(vec2(n.x, n.y));
            bestDist.assign(nDist);
            bestValid.assign(float(1));
          });
        });
      }

      return vec4(bestSeed.x, bestSeed.y, bestValid, float(1));
    });

    const jfaMat: NodeMaterial =
      this._jfaMaterial ?? (this._jfaMaterial = new NodeMaterial());
    jfaMat.fragmentNode = jfaFn().context(builder.getSharedContext());
    jfaMat.name = "JFA_pass";
    jfaMat.needsUpdate = true;

    // Register the source texture as a dependency so the builder tracks it.
    const properties = builder.getNodeProperties(this);
    properties.textureNode = textureNode;

    // ── Stroke mask (inline in the effects-material shader) ───────────────
    // `rawUV`   = Group's corrected UV evaluated at the current billboard
    //             fragment = raw RT texcoord of that fragment.
    // `seedData` = JFA result texture sampled at the same rawUV (via uvNode).
    //
    // Distance is computed in pixel space by scaling the UV delta by texSize.
    // This is Y-flip invariant: ||(u, 1-v) - (su, sv)|| == ||(u, v) - (su, 1-sv)||
    // so no coordinate-space correction is needed.
    const texSize = this._texSize;
    const radiusPxNode = this.radiusPxNode;
    const outputTexNode = this._outputTexNode;

    // rawUV: the RT texcoord of the current effects-material fragment.
    const rawUV = textureNode.uvNode;

    const seedData = vec4(outputTexNode);
    const seedUV = vec2(seedData.x, seedData.y);
    const isValid = step(float(0.5), seedData.z); // 1 if valid seed
    const diff = rawUV.sub(seedUV);
    const distPx = length(diff.mul(texSize));

    const srcAlpha = textureNode.a; // uses Group's corrected UV automatically

    // Outside stroke (seedInvert=false): return an *expanded fill* mask — all pixels
    // within `radius` of the alpha boundary, on BOTH sides.  The caller composites the
    // original content back on top, so interior pixels (srcA=1) are fully covered by the
    // content and the stroke only shows where srcA < 1.  This eliminates the transparent
    // gap that appears at anti-aliased edges when the stroke is limited to srcA < 0.5.
    //
    // Inside stroke (seedInvert=true): keep the srcAlpha check so the stroke stays inside
    // the object and doesn't bleed onto fully-transparent outside pixels.
    const baseMask = isValid.mul(step(distPx, radiusPxNode));
    const mask = seedInvert
      ? baseMask.mul(step(float(0.5), srcAlpha)) // clamp to object interior
      : baseMask; // expanded fill — no side check

    return vec4(mask, mask, mask, float(1));
  }

  dispose(): void {
    this._seedRT.dispose();
    this._pingRT.dispose();
    this._pongRT.dispose();
  }
}

/**
 * Outside stroke via JFA distance field.
 * The stroke band appears *outside* the alpha boundary, extending outward by
 * `radiusPx` screen pixels.
 *
 * @param node       Source texture node (e.g. `group.mapNode`).
 * @param radiusPx   Stroke half-width in **screen pixels** (uniform or float).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jfaOutsideStroke(node: any, radiusPx: any): any {
  return nodeObject(
    new JFAStrokeNode(convertToTexture(node), radiusPx, false),
  );
}

/**
 * Inside stroke via JFA distance field.
 * The stroke band appears *inside* the alpha boundary, extending inward by
 * `radiusPx` screen pixels.
 *
 * @param node       Source texture node (e.g. `group.mapNode`).
 * @param radiusPx   Stroke half-width in **screen pixels** (uniform or float).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jfaInsideStroke(node: any, radiusPx: any): any {
  return nodeObject(
    new JFAStrokeNode(convertToTexture(node), radiusPx, true),
  );
}
