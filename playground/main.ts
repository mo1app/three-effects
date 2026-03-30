import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Pane } from "tweakpane";
import {
  vec4,
  vec2,
  float,
  vec3,
  screenCoordinate,
  uniform,
  smoothstep,
  step,
  mix,
  length,
  sqrt,
} from "three/tsl";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { Group } from "three-group-effects";

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

const group = new Group();
group.effectsEnabled = true;
group.padding = 0.1;
group.position.y = 0.5;
group.add(cube);
scene.add(group);

// Two sphere groups — each orbits around world origin independently
const sphereMat = new THREE.MeshStandardNodeMaterial({
  color: new THREE.Color(0xffaa33),
  metalness: 0.1,
  roughness: 0.55,
});
const sphereGeo = new THREE.SphereGeometry(0.28, 32, 32);
const sphereA = new THREE.Mesh(sphereGeo, sphereMat);
const sphereB = new THREE.Mesh(sphereGeo, sphereMat);

const groupA = new Group();
groupA.effectsEnabled = true;
groupA.padding = 0.05;
groupA.add(sphereA);
scene.add(groupA);

const groupB = new Group();
groupB.effectsEnabled = true;
groupB.padding = 0.05;
groupB.add(sphereB);
scene.add(groupB);

// ── Duotone circle-halftone material (sphere groups) ──────────────────────────
const duotoneDark = uniform(new THREE.Color(0x000000));
const duotoneLight = uniform(new THREE.Color(0xffffff));
const dotSize = uniform(15.0);
const lumMin = uniform(0.1);
const lumMax = uniform(0.4);

// Shared halftone cell geometry (same for both groups)
const cellPos = screenCoordinate.xy.div(dotSize).fract().mul(2.0).sub(1.0);
const dist = length(cellPos);
const edgeWidth = float(2.0).div(dotSize);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDitherMat(srcNode: any) {
  const lum = srcNode.r
    .mul(0.2126)
    .add(srcNode.g.mul(0.7152))
    .add(srcNode.b.mul(0.0722));
  const remapped = lum.sub(lumMin).div(lumMax.sub(lumMin)).clamp(0.0, 1.0);
  const r = sqrt(remapped);
  const visible = step(float(0.001), remapped);
  const mask = float(1.0)
    .sub(smoothstep(r.sub(edgeWidth), r.add(edgeWidth), dist))
    .mul(visible)
    .mul(srcNode.a);
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: true,
    side: 2,
  });
  mat.colorNode = vec4(
    mix(vec3(duotoneDark), vec3(duotoneLight), mask),
    srcNode.a,
  );
  return mat;
}

groupA.effectsMaterial = makeDitherMat(groupA.mapNode);
groupB.effectsMaterial = makeDitherMat(groupB.mapNode);

// ── B&W + soft border material (cube group) ───────────────────────────────────
const bwMin = uniform(0.0);
const bwMax = uniform(0.09);
const borderCol = uniform(new THREE.Color(0x000000));
const borderThreshold = uniform(0.04); // hard-edge cutoff on the halo

// GaussianBlurNode blurs the render-target texture once per frame (two-pass H+V).
// premultipliedAlpha:true makes the alpha expand into transparent surrounds,
// so (blurredAlpha - originalAlpha) gives a smooth halo outside the shape.
// directionNode is a TSL uniform → scales blur spread live without shader recompile.
// sigma (fixed) controls kernel quality/tap count.
const blurRadius = uniform(0.3);
const blurNode = gaussianBlur(group.mapNode, blurRadius, 12);
blurNode.premultipliedAlpha = true;

const bwMat = new THREE.MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: true,
  side: 2,
});

const bwSrc = group.mapNode;
const bwLum = bwSrc.r
  .mul(0.2126)
  .add(bwSrc.g.mul(0.7152))
  .add(bwSrc.b.mul(0.0722));
const bwOut = bwLum.sub(bwMin).div(bwMax.sub(bwMin)).clamp(0.0, 1.0);

// Halo = blurred alpha minus sharp alpha, stepped to a hard edge
const halo = step(borderThreshold, blurNode.a.sub(bwSrc.a).max(0.0));

// Drop shadow — blur an offset sample of the same render target
const shadowOffset = uniform(new THREE.Vector2(0.0, -0.02));
const shadowRadius = uniform(2.0);
const shadowOpacity = uniform(1.0);
const shadowCol = uniform(new THREE.Color(0x000000));

const shadowSrc = group.createOffsetSample(shadowOffset);
const shadowBlur = gaussianBlur(shadowSrc, shadowRadius, 12);
shadowBlur.premultipliedAlpha = true;
const shadowMask = shadowBlur.a.mul(shadowOpacity).clamp(0.0, 1.0);

// Composite: shadow (bottom) → content → border (top)
const colOverShadow = mix(vec3(shadowCol), vec3(bwOut), bwSrc.a);
const colWithBorder = mix(colOverShadow, vec3(borderCol), halo);
const finalAlpha = shadowMask.max(bwSrc.a).max(halo);
bwMat.colorNode = vec4(colWithBorder, finalAlpha);
group.effectsMaterial = bwMat;

// ── Tweakpane ─────────────────────────────────────────────────────────────────
const pane = new Pane({ title: "three-group-effects" });

const f1 = pane.addFolder({ title: "group (cube) — b&w + outline" });
f1.addBinding(group, "effectsEnabled", { label: "effectsEnabled" });
f1.addBinding(group, "padding", {
  label: "padding",
  min: 0,
  max: 0.3,
  step: 0.01,
});
const bwProxy = { min: 0.0, max: 0.09 };
f1.addBinding(bwProxy, "min", {
  label: "lum min",
  min: 0,
  max: 1,
  step: 0.01,
}).on("change", ({ value }) => {
  bwMin.value = value;
});
f1.addBinding(bwProxy, "max", {
  label: "lum max",
  min: 0,
  max: 1,
  step: 0.01,
}).on("change", ({ value }) => {
  bwMax.value = value;
});
const borderProxy = {
  color: { r: 0, g: 0, b: 0 },
  radius: 0.5,
  threshold: 0.04,
};
blurRadius.value = borderProxy.radius;
f1.addBinding(borderProxy, "color", {
  label: "border color",
  view: "color",
}).on("change", ({ value }) => {
  (borderCol.value as THREE.Color).setRGB(
    value.r / 255,
    value.g / 255,
    value.b / 255,
  );
});
f1.addBinding(borderProxy, "radius", {
  label: "border radius",
  min: 0,
  max: 10,
  step: 0.1,
}).on("change", ({ value }) => {
  blurRadius.value = value;
});
f1.addBinding(borderProxy, "threshold", {
  label: "border threshold",
  min: 0,
  max: 1,
  step: 0.01,
}).on("change", ({ value }) => {
  borderThreshold.value = value;
});
const shadowProxy = {
  color: { r: 0, g: 0, b: 0 },
  offsetX: 0.0,
  offsetY: -0.02,
  radius: 2.0,
  opacity: 1.0,
};
f1.addBinding(shadowProxy, "color", {
  label: "shadow color",
  view: "color",
}).on("change", ({ value }) => {
  (shadowCol.value as THREE.Color).setRGB(
    value.r / 255,
    value.g / 255,
    value.b / 255,
  );
});
f1.addBinding(shadowProxy, "offsetX", {
  label: "shadow offset x",
  min: -0.1,
  max: 0.1,
  step: 0.002,
}).on("change", ({ value }) => {
  (shadowOffset.value as THREE.Vector2).x = value;
});
f1.addBinding(shadowProxy, "offsetY", {
  label: "shadow offset y",
  min: -0.1,
  max: 0.1,
  step: 0.002,
}).on("change", ({ value }) => {
  (shadowOffset.value as THREE.Vector2).y = value;
});
f1.addBinding(shadowProxy, "radius", {
  label: "shadow radius",
  min: 0,
  max: 5,
  step: 0.1,
}).on("change", ({ value }) => {
  shadowRadius.value = value;
});
f1.addBinding(shadowProxy, "opacity", {
  label: "shadow opacity",
  min: 0,
  max: 1,
  step: 0.01,
}).on("change", ({ value }) => {
  shadowOpacity.value = value;
});

const f2 = pane.addFolder({ title: "spheres — duotone dither" });
const sphereProxy = { effectsEnabled: true, padding: 0.05 };
f2.addBinding(sphereProxy, "effectsEnabled", { label: "effectsEnabled" }).on(
  "change",
  ({ value }) => {
    groupA.effectsEnabled = value;
    groupB.effectsEnabled = value;
  },
);
f2.addBinding(sphereProxy, "padding", {
  label: "padding",
  min: 0,
  max: 0.3,
  step: 0.01,
}).on("change", ({ value }) => {
  groupA.padding = value;
  groupB.padding = value;
});
const duotoneProxy = {
  dark: { r: 0, g: 0, b: 0 },
  light: { r: 255, g: 255, b: 255 },
};
f2.addBinding(duotoneProxy, "dark", {
  label: "shadow color",
  view: "color",
}).on("change", ({ value }) => {
  (duotoneDark.value as THREE.Color).setRGB(
    value.r / 255,
    value.g / 255,
    value.b / 255,
  );
});
f2.addBinding(duotoneProxy, "light", {
  label: "highlight color",
  view: "color",
}).on("change", ({ value }) => {
  (duotoneLight.value as THREE.Color).setRGB(
    value.r / 255,
    value.g / 255,
    value.b / 255,
  );
});
const dotSizeProxy = { dotSize: 15 };
f2.addBinding(dotSizeProxy, "dotSize", {
  label: "dot size",
  min: 1,
  max: 80,
  step: 1,
}).on("change", ({ value }) => {
  dotSize.value = value;
});
const lumRangeProxy = { min: 0.1, max: 0.4 };
f2.addBinding(lumRangeProxy, "min", {
  label: "lum min (0 radius)",
  min: 0,
  max: 1,
  step: 0.01,
}).on("change", ({ value }) => {
  lumMin.value = value;
});
f2.addBinding(lumRangeProxy, "max", {
  label: "lum max (full radius)",
  min: 0,
  max: 1,
  step: 0.01,
}).on("change", ({ value }) => {
  lumMax.value = value;
});

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

  // Each group orbits around the world origin
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
