// @ts-nocheck
/**
 * Multi-pass Kawase blur (few fullscreen passes vs wide separable Gaussian).
 * Same integration pattern as Three.js `GaussianBlurNode`: `updateBefore` ping-pong RTs,
 * `passTexture` output, optional premultiplied alpha.
 */
import {
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
  mul,
  nodeObject,
  passTexture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

const _quadMesh = new QuadMesh();

let _rendererState;

const kawasePremult = Fn(([color]) =>
  vec4(color.rgb.mul(color.a), color.a),
).setLayout({
  name: "kawase_premult",
  type: "vec4",
  inputs: [{ name: "color", type: "vec4" }],
});

const kawaseUnpremult = Fn(([color]) => {
  If(color.a.equal(0.0), () => vec4(0.0));
  return vec4(color.rgb.div(color.a), color.a);
}).setLayout({
  name: "kawase_unpremult",
  type: "vec4",
  inputs: [{ name: "color", type: "vec4" }],
});

class KawaseBlurNode extends TempNode {
  static get type() {
    return "KawaseBlurNode";
  }

  textureNode;
  directionNode;
  /** Each pass = 5 taps. Kept even so the result always lives in `_rtB`. */
  numPasses;

  _invSize = uniform(new Vector2());
  _passIndexUniform = uniform(0);
  _rtA;
  _rtB;
  _outTexture;
  _material = null;

  resolution = new Vector2(1, 1);
  premultipliedAlpha = false;

  constructor(textureNode, directionNode = null, numPasses = 4) {
    super("vec4");

    this.textureNode = convertToTexture(textureNode);
    this.directionNode = directionNode;
    const n = Math.max(2, Math.floor(numPasses));
    this.numPasses = n % 2 === 0 ? n : n + 1;

    this._rtA = new RenderTarget(1, 1, { depthBuffer: false });
    this._rtA.texture.name = "KawaseBlurNode.A";
    this._rtB = new RenderTarget(1, 1, { depthBuffer: false });
    this._rtB.texture.name = "KawaseBlurNode.B";

    this._outTexture = passTexture(this, this._rtB.texture);
    this._outTexture.uvNode = this.textureNode.uvNode;

    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  setSize(width, height) {
    width = Math.max(Math.round(width * this.resolution.x), 1);
    height = Math.max(Math.round(height * this.resolution.y), 1);
    this._invSize.value.set(1 / width, 1 / height);
    this._rtA.setSize(width, height);
    this._rtB.setSize(width, height);
  }

  updateBefore(frame) {
    const { renderer } = frame;
    if (!renderer) return;

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

    const textureNode = this.textureNode;
    const map = textureNode.value;
    const currentTexture = textureNode.value;

    _quadMesh.material = this._material;

    this.setSize(map.image.width, map.image.height);

    const textureType = map.type;
    this._rtA.texture.type = textureType;
    this._rtB.texture.type = textureType;

    let readTex = currentTexture;
    const n = this.numPasses;

    for (let p = 0; p < n; p++) {
      this._passIndexUniform.value = p;
      const writeRT = p % 2 === 0 ? this._rtA : this._rtB;
      renderer.setRenderTarget(writeRT);
      textureNode.value = readTex;
      _quadMesh.render(renderer);
      readTex = writeRT.texture;
    }

    textureNode.value = currentTexture;
    RendererUtils.restoreRendererState(renderer, _rendererState);
  }

  getTextureNode() {
    return this._outTexture;
  }

  setup(builder) {
    const textureNode = this.textureNode;
    const uvNode = uv();
    const directionNode = vec2(this.directionNode ?? 1);

    let sampleTexture;
    let output;

    if (this.premultipliedAlpha) {
      sampleTexture = (u) => kawasePremult(textureNode.sample(u));
      output = (c) => kawaseUnpremult(c);
    } else {
      sampleTexture = (u) => textureNode.sample(u);
      output = (c) => c;
    }

    const kawase = Fn(() => {
      const invSize = this._invSize;
      const passT = float(this._passIndexUniform).add(0.5);
      const d = directionNode.mul(invSize).mul(passT);
      const dx = d.x;
      const dy = d.y;
      const ndx = mul(dx, float(-1));
      const ndy = mul(dy, float(-1));

      const s0 = sampleTexture(uvNode).mul(0.2);
      const s1 = sampleTexture(uvNode.add(vec2(dx, dy))).mul(0.2);
      const s2 = sampleTexture(uvNode.add(vec2(ndx, dy))).mul(0.2);
      const s3 = sampleTexture(uvNode.add(vec2(dx, ndy))).mul(0.2);
      const s4 = sampleTexture(uvNode.add(vec2(ndx, ndy))).mul(0.2);

      return output(s0.add(s1).add(s2).add(s3).add(s4));
    });

    const material =
      this._material || (this._material = new NodeMaterial());
    material.fragmentNode = kawase().context(builder.getSharedContext());
    material.name = "Kawase_blur";
    material.needsUpdate = true;

    const properties = builder.getNodeProperties(this);
    properties.textureNode = textureNode;

    return this._outTexture;
  }

  dispose() {
    this._rtA.dispose();
    this._rtB.dispose();
  }
}

export function kawaseBlur(
  node: unknown,
  directionNode: unknown,
  numPasses: number,
): unknown {
  return nodeObject(new KawaseBlurNode(node, directionNode, numPasses));
}
