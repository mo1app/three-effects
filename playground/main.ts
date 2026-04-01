import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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

// WebGPU: requestAdapter({ powerPreference }) — discrete GPU when available.
const renderer = new THREE.WebGPURenderer({
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
/** Keep in sync with `body` / `html` background in `index.html` (first paint). */
const PLAYGROUND_SCENE_BACKGROUND = 0xcccccc;
scene.background = new THREE.Color(PLAYGROUND_SCENE_BACKGROUND);
const playgroundBgCss = `#${PLAYGROUND_SCENE_BACKGROUND.toString(16).padStart(6, "0")}`;
document.documentElement.style.backgroundColor = playgroundBgCss;
document.body.style.backgroundColor = playgroundBgCss;

const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(-0.552, 2.168, 13.009);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, -1.204, 0);
controls.update();

const key = new THREE.DirectionalLight(0xffffff, 3.5);
key.position.set(2.5, 4, 3);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.28));

const grid = new THREE.GridHelper(10, 20, 0x999999, 0x999999);
grid.position.y = -1;
grid.rotation.y = Math.PI * 0.25;
scene.add(grid);

const duckRoot = new THREE.Group();

const cubeGroup = new EffectsGroup();
cubeGroup.debug = true;
cubeGroup.debugColor.set(0x00aa44);
cubeGroup.paddingExtra = 0;
cubeGroup.position.y = 0.5;
cubeGroup.add(duckRoot);
scene.add(cubeGroup);

const duckGlbUrl = `${import.meta.env.BASE_URL}duck.glb`;

/** Reuse the diffuse map as emissive, mild glow (standard GLTF materials). */
function applyEmissiveFromMap(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || !("map" in m) || !m.map) continue;
      const std = m as THREE.MeshStandardMaterial;
      std.emissiveMap = std.map;
      std.emissive.set(0xffffff);
      std.emissiveIntensity = 0.8;
    }
  });
}

new GLTFLoader().load(
  duckGlbUrl,
  (gltf) => {
    const model = gltf.scene;
    applyEmissiveFromMap(model);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const targetMax = 3;
    const s = targetMax / maxDim;
    model.scale.setScalar(s);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    duckRoot.add(model);
  },
  undefined,
  (err) => {
    console.error("Failed to load duck.glb", err);
  },
);

const orbitObjectMat = new THREE.MeshStandardNodeMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.1,
  roughness: 0.55,
});
const sphereGeo = new THREE.SphereGeometry(0.28, 32, 32);
/** Cube edge ≈ sphere diameter so silhouette is similar. */
const boxGeo = new THREE.BoxGeometry(0.56, 0.56, 0.56);
const sphereMesh = new THREE.Mesh(sphereGeo, orbitObjectMat);
const boxMesh = new THREE.Mesh(boxGeo, orbitObjectMat);

const sphereGroup = new EffectsGroup();
sphereGroup.debug = true;
sphereGroup.debugColor.set(0xff6600);
sphereGroup.paddingExtra = 0;
sphereGroup.add(sphereMesh);
scene.add(sphereGroup);

const boxGroup = new EffectsGroup();
boxGroup.debug = true;
boxGroup.debugColor.set(0xff0066);
boxGroup.paddingExtra = 0;
boxGroup.add(boxMesh);
scene.add(boxGroup);

function makeLabel(text: string, borderColor: THREE.Color): THREE.Mesh {
  const labelH = 66,
    PAD = 16;
  const FONT = "bold 28px monospace";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const W = Math.ceil(measure.measureText(text).width) + PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = labelH;
  const ctx = canvas.getContext("2d")!;
  /** Same hex as {@link EffectsGroup.debugColor} / debug border (Three `Color#getHexString`). */
  ctx.fillStyle = `#${borderColor.getHexString()}`;
  ctx.fillRect(0, 0, W, labelH);
  ctx.fillStyle = "#ffffff";
  ctx.font = FONT;
  ctx.fillText(text, PAD, 45);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    side: 2,
  });
  mat.colorNode = tslTexture(tex);
  const h = 41;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(h * (W / labelH), h),
    mat,
  );
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  const w = h * (W / labelH);
  /** Outside the debug rect at top-right (x as before); y so label bottom meets the quad corner. */
  mesh.position.set(-w / 2, h / 2, 0);
  return mesh;
}

cubeGroup.debugGroup.add(makeLabel("duck", cubeGroup.debugColor));
sphereGroup.debugGroup.add(makeLabel("sphere", sphereGroup.debugColor));
boxGroup.debugGroup.add(makeLabel("box", boxGroup.debugColor));

const layerObjects: Record<string, EffectsGroup> = {
  group: cubeGroup,
  groupA: sphereGroup,
  groupB: boxGroup,
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
    const gradientOverlay = editorModel.value.effects[layerId]
      ?.gradientOverlay as GradientOverlayEffectState | undefined;
    const blur = editorModel.value.effects[layerId]?.blur as
      | BlurEffectState
      | undefined;

    const layerRow = editorModel.value.layers.find((l) => l.id === layerId);
    if (layerRow) {
      g.visible = layerRow.visible;
    }

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

  duckRoot.rotation.y = t * 0.65;

  const orbitR = 2;
  const orbitY = 0.8;
  sphereGroup.position.set(
    Math.cos(t * 0.9) * orbitR,
    orbitY + Math.sin(t * 0.2) * 0.25,
    Math.sin(t * 0.9) * orbitR,
  );
  boxGroup.position.set(
    Math.cos(t * 0.9 + Math.PI) * orbitR,
    orbitY + Math.sin(t * 0.2 + Math.PI) * 0.25,
    Math.sin(t * 0.9 + Math.PI) * orbitR,
  );

  boxMesh.rotation.x = t * 0.25;
  boxMesh.rotation.y = t * 0.8;

  controls.update();
  preRenderEffects(renderer, scene, camera);
  renderer.render(scene, camera);
});
