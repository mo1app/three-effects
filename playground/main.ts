import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { texture as tslTexture } from "three/tsl";
import { createApp, watch } from "vue";
import {
  Group as EffectsGroup,
  preRenderEffects,
  type GroupEffects,
} from "../src/index.js";
import App from "./App.vue";
import {
  editorModel,
  type BlurEffectState,
  type ColorOverlayEffectState,
  type DropShadowEffectState,
  type GradientOverlayEffectState,
  type InnerGlowEffectState,
  type InnerShadowEffectState,
  type OuterGlowEffectState,
  type StrokeEffectState,
} from "./layersModel";
import "./shake.css";

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

const cubeGroup = new EffectsGroup();
cubeGroup.debug = true;
cubeGroup.debugColor.set(0x00aa44);
cubeGroup.paddingExtra = 0;
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

const groupA = new EffectsGroup();
groupA.debug = true;
groupA.debugColor.set(0xff6600);
groupA.paddingExtra = 0;
groupA.add(sphereA);
scene.add(groupA);

const groupB = new EffectsGroup();
groupB.debug = true;
groupB.debugColor.set(0xff0066);
groupB.paddingExtra = 0;
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
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    side: 2,
  });
  mat.colorNode = tslTexture(tex);
  const h = 50;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(h * (W / labelH), h),
    mat,
  );
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  const w = h * (W / labelH);
  mesh.position.set(-w / 2, -h / 2, 0);
  return mesh;
}

cubeGroup.debugGroup.add(makeLabel("cube", 0x00aa44));
groupA.debugGroup.add(makeLabel("sphere A", 0xff6600));
groupB.debugGroup.add(makeLabel("sphere B", 0xff0066));

const layerObjects: Record<string, EffectsGroup> = {
  group: cubeGroup,
  groupA,
  groupB,
};

function syncEditorToGroupEffects() {
  for (const layerId of Object.keys(layerObjects)) {
    const g = layerObjects[layerId]!;
    const stroke = editorModel.value.effects[layerId]?.stroke as
      | StrokeEffectState
      | undefined;
    const colorOverlay = editorModel.value.effects[layerId]?.colorOverlay as
      | ColorOverlayEffectState
      | undefined;
    const dropShadow = editorModel.value.effects[layerId]?.dropShadow as
      | DropShadowEffectState
      | undefined;
    const innerShadow = editorModel.value.effects[layerId]?.innerShadow as
      | InnerShadowEffectState
      | undefined;
    const innerGlow = editorModel.value.effects[layerId]?.innerGlow as
      | InnerGlowEffectState
      | undefined;
    const outerGlow = editorModel.value.effects[layerId]?.outerGlow as
      | OuterGlowEffectState
      | undefined;
    const gradientOverlay = editorModel.value.effects[layerId]?.gradientOverlay as
      | GradientOverlayEffectState
      | undefined;
    const blur = editorModel.value.effects[layerId]?.blur as BlurEffectState | undefined;

    const layerRow = editorModel.value.layers.find((l) => l.id === layerId);

    g.applyEffects((e: GroupEffects) => {
      if (layerRow) {
        e.opacity.enabled = layerRow.opacity.enabled;
        e.opacity.value = layerRow.opacity.value;
      }

      const useStroke = stroke?.initialized && stroke.enabled;
      e.stroke.enabled = !!useStroke;
      if (stroke?.initialized) {
        e.stroke.sizePx = stroke.sizePx;
        e.stroke.position = stroke.position;
        e.stroke.opacity = stroke.opacity;
        e.stroke.color.set(stroke.color);
      }

      const useCo = colorOverlay?.initialized && colorOverlay.enabled;
      e.colorOverlay.enabled = !!useCo;
      if (colorOverlay?.initialized) {
        e.colorOverlay.opacity = colorOverlay.opacity;
        e.colorOverlay.color.set(colorOverlay.color);
      }

      const useDs = dropShadow?.initialized && dropShadow.enabled;
      e.dropShadow.enabled = !!useDs;
      if (dropShadow?.initialized) {
        e.dropShadow.opacity = dropShadow.opacity;
        e.dropShadow.angle = dropShadow.angle;
        e.dropShadow.distancePx = dropShadow.distancePx;
        e.dropShadow.spread = dropShadow.spread;
        e.dropShadow.sizePx = dropShadow.sizePx;
        e.dropShadow.color.set(dropShadow.color);
      }

      const useOg = outerGlow?.initialized && outerGlow.enabled;
      e.outerGlow.enabled = !!useOg;
      if (outerGlow?.initialized) {
        e.outerGlow.opacity = outerGlow.opacity;
        e.outerGlow.spread = outerGlow.spread;
        e.outerGlow.sizePx = outerGlow.sizePx;
        e.outerGlow.color.set(outerGlow.color);
      }

      const useGo = gradientOverlay?.initialized && gradientOverlay.enabled;
      e.gradientOverlay.enabled = !!useGo;
      if (gradientOverlay?.initialized) {
        e.gradientOverlay.opacity = gradientOverlay.opacity;
        e.gradientOverlay.style = gradientOverlay.style;
        e.gradientOverlay.angle = gradientOverlay.angle;
        e.gradientOverlay.scale = gradientOverlay.scale;
        e.gradientOverlay.reverse = gradientOverlay.reverse;
        e.gradientOverlay.stops = gradientOverlay.stops.map((s) => ({
          color: s.color,
          position: s.position,
        }));
      }

      const useIs = innerShadow?.initialized && innerShadow.enabled;
      e.innerShadow.enabled = !!useIs;
      if (innerShadow?.initialized) {
        e.innerShadow.opacity = innerShadow.opacity;
        e.innerShadow.angle = innerShadow.angle;
        e.innerShadow.distancePx = innerShadow.distancePx;
        e.innerShadow.choke = innerShadow.choke;
        e.innerShadow.sizePx = innerShadow.sizePx;
        e.innerShadow.color.set(innerShadow.color);
      }

      const useIg = innerGlow?.initialized && innerGlow.enabled;
      e.innerGlow.enabled = !!useIg;
      if (innerGlow?.initialized) {
        e.innerGlow.opacity = innerGlow.opacity;
        e.innerGlow.source = innerGlow.source;
        e.innerGlow.choke = innerGlow.choke;
        e.innerGlow.sizePx = innerGlow.sizePx;
        e.innerGlow.color.set(innerGlow.color);
      }

      const useBlur = blur?.initialized && blur.enabled;
      e.blur.enabled = !!useBlur;
      if (blur?.initialized) {
        e.blur.sizePx = blur.sizePx;
      }
    });
  }
}

function toggleLayerVisibility(id: string) {
  const entry = editorModel.value.layers.find((l) => l.id === id);
  if (!entry) return;
  entry.visible = !entry.visible;
  const obj = layerObjects[id];
  if (obj) obj.visible = entry.visible;
}

const uiRoot = document.querySelector("#ui");
if (uiRoot) {
  createApp(App, { toggleLayerVisibility }).mount(uiRoot);
}

watch(editorModel, syncEditorToGroupEffects, { deep: true });
syncEditorToGroupEffects();

watch(
  () => editorModel.value.groupHelpersVisible,
  (visible) => {
    for (const g of Object.values(layerObjects)) {
      g.debug = visible;
    }
  },
  { immediate: true },
);

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
  preRenderEffects(renderer, scene, camera);
  renderer.render(scene, camera);
});
