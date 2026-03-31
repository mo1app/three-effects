/**
 * Separable morphological dilation / erosion via two-pass max/min-pool.
 *
 * Architecture mirrors `GaussianBlurNode` (horizontal pass → RT1, vertical pass → RT2)
 * but replaces the weighted-average kernel with a component-wise max (dilate) or min
 * (erode). The result is an L∞ (Chebyshev) distance expansion/shrink, which preserves
 * 90° corners exactly — unlike a Gaussian blur whose two-pass product is a rounded disc.
 *
 * The `directionNode` parameter follows the same unit convention as `GaussianBlurNode`:
 * it is in **pixel (texel) units**. The node divides by texture size internally, so
 * the effective kernel half-width in screen pixels is `(2 + 2 * sigma) * directionNode`.
 *
 * Usage for an N-pixel stroke:
 * ```ts
 * const d = N / (2 + 2 * sigma);
 * const dilated = maxPoolDilate(group.mapNode, uniform(d), sigma);
 * const strokeMask = step(0.1, dilated.a.sub(srcAlpha));
 * ```
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
  float,
  max,
  min,
  nodeObject,
  passTexture,
  convertToTexture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

// Shared quad mesh — one instance is sufficient since passes are never concurrent.
const _quadMesh = /* @__PURE__ */ new QuadMesh();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rendererState: any;

class MorphologyNode extends TempNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textureNode: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  directionNode: any;
  sigma: number;
  mode: "dilate" | "erode";

  private readonly _invSize = uniform(new Vector2());
  private readonly _passDirection = uniform(new Vector2());
  private readonly _horizontalRT: RenderTarget;
  private readonly _verticalRT: RenderTarget;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _textureNode: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _material: any = null;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    textureNode: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    directionNode: any = null,
    sigma = 2,
    mode: "dilate" | "erode" = "dilate",
  ) {
    super("vec4");
    this.textureNode = textureNode;
    this.directionNode = directionNode;
    this.sigma = sigma;
    this.mode = mode;

    this._horizontalRT = new RenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType,
    });
    this._verticalRT = new RenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType,
    });

    // passTexture expects PassNode in types but TempNode works at runtime
    // (same pattern as GaussianBlurNode.js which is plain JS).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._textureNode = passTexture(this as any, this._verticalRT.texture);
    this._textureNode.uvNode = textureNode.uvNode;

    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  setSize(width: number, height: number): void {
    this._invSize.value.set(1 / width, 1 / height);
    this._horizontalRT.setSize(width, height);
    this._verticalRT.setSize(width, height);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBefore(frame: any): void {
    const { renderer } = frame;
    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

    const textureNode = this.textureNode;
    const currentTexture = textureNode.value;

    _quadMesh.material = this._material;
    this.setSize(currentTexture.image.width, currentTexture.image.height);

    // Horizontal pass
    renderer.setRenderTarget(this._horizontalRT);
    this._passDirection.value.set(1, 0);
    _quadMesh.render(renderer);

    // Vertical pass (samples the horizontal result)
    textureNode.value = this._horizontalRT.texture;
    renderer.setRenderTarget(this._verticalRT);
    this._passDirection.value.set(0, 1);
    _quadMesh.render(renderer);

    // Restore
    textureNode.value = currentTexture;
    RendererUtils.restoreRendererState(renderer, _rendererState);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(builder: any): any {
    const uvNode = uv();
    const directionNode = vec2(this.directionNode || 1);
    const kernelSize = 3 + 2 * this.sigma;
    const invSize = this._invSize;
    const direction = directionNode.mul(this._passDirection);
    const textureNode = this.textureNode;
    const isDilate = this.mode === "dilate";

    const morphology = Fn(() => {
      // Centre sample is the starting value — then expand via max (dilate) or min (erode).
      const result = vec4(textureNode.sample(uvNode)).toVar();

      for (let i = 1; i < kernelSize; i++) {
        const uvOffset = vec2(direction.mul(invSize.mul(float(i)))).toVar();
        const s1 = vec4(textureNode.sample(uvNode.add(uvOffset)));
        const s2 = vec4(textureNode.sample(uvNode.sub(uvOffset)));

        if (isDilate) {
          result.assign(max(result, max(s1, s2)));
        } else {
          result.assign(min(result, min(s1, s2)));
        }
      }

      return result;
    });

    const material: NodeMaterial =
      this._material ?? (this._material = new NodeMaterial());
    material.fragmentNode = morphology().context(builder.getSharedContext());
    material.name = isDilate ? "MaxPool_dilate" : "MinPool_erode";
    material.needsUpdate = true;

    const properties = builder.getNodeProperties(this);
    properties.textureNode = textureNode;

    return this._textureNode;
  }

  dispose(): void {
    this._horizontalRT.dispose();
    this._verticalRT.dispose();
  }
}

/**
 * Separable max-pool dilation — expands the alpha boundary outward by
 * `(2 + 2 * sigma) * directionNode` pixels. Use for **outside** strokes.
 *
 * @param node        Source texture node (e.g. `group.mapNode`).
 * @param directionNode Kernel half-extent in **pixel units**: `N / (2 + 2 * sigma)`.
 * @param sigma       Number of kernel taps on each side (higher = smoother edge).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function maxPoolDilate(node: any, directionNode: any, sigma: number): any {
  return nodeObject(
    new MorphologyNode(convertToTexture(node), directionNode, sigma, "dilate"),
  );
}

/**
 * Separable min-pool erosion — shrinks the alpha boundary inward by
 * `(2 + 2 * sigma) * directionNode` pixels. Use for **inside** strokes.
 *
 * @param node        Source texture node (e.g. `group.mapNode`).
 * @param directionNode Kernel half-extent in **pixel units**: `N / (2 + 2 * sigma)`.
 * @param sigma       Number of kernel taps on each side.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function minPoolErode(node: any, directionNode: any, sigma: number): any {
  return nodeObject(
    new MorphologyNode(convertToTexture(node), directionNode, sigma, "erode"),
  );
}
