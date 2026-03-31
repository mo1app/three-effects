import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { texture as tslTexture, uniform } from "three/tsl";
import { createApp, watch } from "vue";
import { colorStopsFromSerialized, createGradientTexture, layerStyles } from "three-group-effects";
import { Group } from "../src/Group.js";
import App from "./App.vue";
import {
  editorModel,
  type ColorOverlayEffectState,
  type DropShadowEffectState,
  type GradientOverlayEffectState,
  type InnerGlowEffectState,
  type InnerShadowEffectState,
  type OuterGlowEffectState,
  type StrokeEffectState,
} from "./layersModel";
import "./shake.css";

/** Stroke size uniforms keyed by layer ID — value is stroke radius in screen pixels. */
const strokeSizeUniforms: Record<string, ReturnType<typeof uniform<number>>> = {};

/** Rebuilt whenever gradient overlay stops change for that layer. */
const gradientTextures: Record<string, THREE.DataTexture> = {};

/**
 * Drop shadow blur sigma — keeps kernel quality consistent with the library default.
 * To convert a UI "Size" in screen pixels to the `blurRadius` that GaussianBlurNode
 * expects (pixel units), use: `sizePx / (2 + 2 * DS_SIGMA)`.
 *
 * `distance` (UV space) is derived from `distancePx / group.renderTargetWidth`;
 * when the RT has not been sized yet we fall back to a 200 px estimate.
 */
const DS_SIGMA = 12;

/** Inner shadow / inner glow / outer glow blur sigma (matches library defaults). */
const IS_SIGMA = 8;
const IG_SIGMA = 8;
const OG_SIGMA = 8;

const root = document.querySelector("#app")!;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 0.6, 8.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

const key = new THREE.DirectionalLight(0xffffff, 1.15);
key.position.set(2.5, 4, 3);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.28));

const grid = new THREE.GridHelper(10, 20, 0x334155, 0x1e293b);
scene.add(grid);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(0x6ae3ff),
    metalness: 0.25,
    roughness: 0.42,
  }),
);

const cubeGroup = new Group();
// Must stay true: RT capture + billboard + mapNode/layerStyles only run when effects are on.
// We do not toggle this from the Layers UI — only `effectsMaterial` (passthrough vs stroke).
cubeGroup.effectsEnabled = true;
cubeGroup.debug = true;
cubeGroup.debugColor.set(0x00aa44);
cubeGroup.padding = 0.1;
cubeGroup.position.y = 0.5;
cubeGroup.add(cube);
scene.add(cubeGroup);

const sphereMat = new THREE.MeshStandardNodeMaterial({
  color: new THREE.Color(0xffaa33),
  metalness: 0.1,
  roughness: 0.55,
});
const sphereGeo = new THREE.SphereGeometry(0.28, 32, 32);
const sphereA = new THREE.Mesh(sphereGeo, sphereMat);
const sphereB = new THREE.Mesh(sphereGeo, sphereMat);

const groupA = new Group();
groupA.effectsEnabled = true; // see cubeGroup comment
groupA.debug = true;
groupA.debugColor.set(0xff6600);
groupA.padding = 0.05;
groupA.add(sphereA);
scene.add(groupA);

const groupB = new Group();
groupB.effectsEnabled = true; // see cubeGroup comment
groupB.debug = true;
groupB.debugColor.set(0xff0066);
groupB.padding = 0.05;
groupB.add(sphereB);
scene.add(groupB);

function makeLabel(text: string, bgHex: number): THREE.Mesh {
  const labelH = 80,
    PAD = 20;
  const FONT = "bold 34px monospace";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const W = Math.ceil(measure.measureText(text).width) + PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = labelH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `#${bgHex.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, W, labelH);
  ctx.fillStyle = "#ffffff";
  ctx.font = FONT;
  ctx.fillText(text, PAD, 54);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, side: 2 });
  mat.colorNode = tslTexture(tex);
  const h = 50;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * (W / labelH), h), mat);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  const w = h * (W / labelH);
  mesh.position.set(-w / 2, -h / 2, 0);
  return mesh;
}

cubeGroup.debugGroup.add(makeLabel("cube", 0x00aa44));
groupA.debugGroup.add(makeLabel("sphere A", 0xff6600));
groupB.debugGroup.add(makeLabel("sphere B", 0xff0066));

const layerObjects: Record<string, InstanceType<typeof Group>> = {
  group: cubeGroup,
  groupA,
  groupB,
};

function syncEffectsMaterials() {
  for (const layerId of Object.keys(layerObjects)) {
    const g = layerObjects[layerId]!;
    const prev = g.effectsMaterial;
    const stroke = editorModel.effects[layerId]?.stroke as StrokeEffectState | undefined;
    const colorOverlay = editorModel.effects[layerId]?.colorOverlay as
      | ColorOverlayEffectState
      | undefined;
    const dropShadow = editorModel.effects[layerId]?.dropShadow as
      | DropShadowEffectState
      | undefined;
    const innerShadow = editorModel.effects[layerId]?.innerShadow as
      | InnerShadowEffectState
      | undefined;
    const innerGlow = editorModel.effects[layerId]?.innerGlow as InnerGlowEffectState | undefined;
    const outerGlow = editorModel.effects[layerId]?.outerGlow as OuterGlowEffectState | undefined;
    const gradientOverlay = editorModel.effects[layerId]?.gradientOverlay as
      | GradientOverlayEffectState
      | undefined;

    const useStroke = stroke?.initialized && stroke.enabled;
    const useColorOverlay = colorOverlay?.initialized && colorOverlay.enabled;
    const useDropShadow = dropShadow?.initialized && dropShadow.enabled;
    const useInnerShadow = innerShadow?.initialized && innerShadow.enabled;
    const useInnerGlow = innerGlow?.initialized && innerGlow.enabled;
    const useOuterGlow = outerGlow?.initialized && outerGlow.enabled;
    const useGradientOverlay = gradientOverlay?.initialized && gradientOverlay.enabled;

    if (!useGradientOverlay) {
      gradientTextures[layerId]?.dispose();
      delete gradientTextures[layerId];
    }

    if (
      !useStroke &&
      !useColorOverlay &&
      !useDropShadow &&
      !useInnerShadow &&
      !useInnerGlow &&
      !useOuterGlow &&
      !useGradientOverlay
    ) {
      const mat = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: true,
        side: 2,
      });
      mat.colorNode = g.mapNode as THREE.MeshBasicNodeMaterial["colorNode"];
      g.effectsMaterial = mat;
      prev?.dispose();
      continue;
    }

    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: true,
      side: 2,
    });
    let builder = layerStyles(g);
    const rtW = g.renderTargetWidth > 0 ? g.renderTargetWidth : 200;

    if (useDropShadow) {
      builder = builder.dropShadow({
        color: new THREE.Color(dropShadow!.color),
        opacity: dropShadow!.opacity,
        angle: dropShadow!.angle,
        distance: dropShadow!.distancePx / rtW,
        spread: dropShadow!.spread,
        blurRadius: dropShadow!.sizePx / (2 + 2 * DS_SIGMA),
        sigma: DS_SIGMA,
      });
    }
    if (useOuterGlow) {
      builder = builder.outerGlow({
        color: new THREE.Color(outerGlow!.color),
        opacity: outerGlow!.opacity,
        spread: outerGlow!.spread,
        blurRadius: outerGlow!.sizePx / (2 + 2 * OG_SIGMA),
        sigma: OG_SIGMA,
      });
    }
    if (useColorOverlay) {
      builder = builder.colorOverlay({
        color: new THREE.Color(colorOverlay!.color),
        opacity: colorOverlay!.opacity,
      });
    }
    if (useGradientOverlay) {
      gradientTextures[layerId]?.dispose();
      gradientTextures[layerId] = createGradientTexture(
        colorStopsFromSerialized(gradientOverlay!.stops),
      );
      builder = builder.gradientOverlay({
        texture: gradientTextures[layerId],
        opacity: gradientOverlay!.opacity,
        style: gradientOverlay!.style,
        angle: gradientOverlay!.angle,
        scale: gradientOverlay!.scale,
        reverse: gradientOverlay!.reverse,
      });
    }
    if (useInnerShadow) {
      builder = builder.innerShadow({
        color: new THREE.Color(innerShadow!.color),
        opacity: innerShadow!.opacity,
        angle: innerShadow!.angle,
        distance: innerShadow!.distancePx / rtW,
        choke: innerShadow!.choke,
        blurRadius: innerShadow!.sizePx / (2 + 2 * IS_SIGMA),
        sigma: IS_SIGMA,
      });
    }
    if (useInnerGlow) {
      builder = builder.innerGlow({
        color: new THREE.Color(innerGlow!.color),
        opacity: innerGlow!.opacity,
        source: innerGlow!.source,
        choke: innerGlow!.choke,
        blurRadius: innerGlow!.sizePx / (2 + 2 * IG_SIGMA),
        sigma: IG_SIGMA,
      });
    }
    if (useStroke) {
      // Reuse the per-layer uniform so the material graph is built once and
      // the value is updated cheaply whenever sizePx changes.
      if (!strokeSizeUniforms[layerId]) strokeSizeUniforms[layerId] = uniform(0);
      // JFA takes the stroke radius directly in screen pixels.
      strokeSizeUniforms[layerId].value = stroke!.sizePx;
      builder = builder.stroke({
        color: new THREE.Color(stroke!.color),
        opacity: stroke!.opacity,
        position: stroke!.position,
        size: strokeSizeUniforms[layerId],
      });
    }
    mat.colorNode = builder.node as THREE.MeshBasicNodeMaterial["colorNode"];
    g.effectsMaterial = mat;
    prev?.dispose();
  }
}

function toggleLayerVisibility(id: string) {
  const entry = editorModel.layers.find((l) => l.id === id);
  if (!entry) return;
  entry.visible = !entry.visible;
  const obj = layerObjects[id];
  if (obj) obj.visible = entry.visible;
}

const uiRoot = document.querySelector("#ui");
if (uiRoot) {
  createApp(App, { toggleLayerVisibility }).mount(uiRoot);
}

// Deep-watch the whole model so nested edits (e.g. stroke sizePx) always resync materials.
watch(editorModel, syncEffectsMaterials, { deep: true });
syncEffectsMaterials();

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", onResize);

renderer.setAnimationLoop((time) => {
  const t = time * 0.001;

  cube.rotation.x = t * 0.45;
  cube.rotation.y = t * 0.65;

  const orbitR = 1.5;
  const orbitY = 0.8;
  groupA.position.set(
    Math.cos(t * 0.9) * orbitR,
    orbitY + Math.sin(t * 0.7) * 0.25,
    Math.sin(t * 0.9) * orbitR,
  );
  groupB.position.set(
    Math.cos(t * 0.9 + Math.PI) * orbitR,
    orbitY + Math.sin(t * 0.7 + Math.PI) * 0.25,
    Math.sin(t * 0.9 + Math.PI) * orbitR,
  );

  controls.update();
  Group.preRenderEffects(renderer, scene, camera);
  renderer.render(scene, camera);
});
