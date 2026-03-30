import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Pane } from "tweakpane";
import { Group } from "three-group-effects";

const root = document.querySelector("#app")!;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 0.6, 3.8);

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
group.position.y = 0.5;
group.add(cube);
scene.add(group);

// Second group — two orbiting spheres
const sphereMat = new THREE.MeshStandardNodeMaterial({
  color: new THREE.Color(0xffaa33),
  metalness: 0.1,
  roughness: 0.55,
});
const sphereGeo = new THREE.SphereGeometry(0.28, 32, 32);
const sphereA = new THREE.Mesh(sphereGeo, sphereMat);
const sphereB = new THREE.Mesh(sphereGeo, sphereMat);

const group2 = new Group();
group2.effectsEnabled = true;
group2.padding = 0.05;
group2.position.set(2.4, 0.8, 0);
group2.add(sphereA, sphereB);
scene.add(group2);

// ── Tweakpane ─────────────────────────────────────────────────────────────────
const pane = new Pane({ title: "three-group-effects" });

const f1 = pane.addFolder({ title: "group (cube)" });
f1.addBinding(group, "effectsEnabled", { label: "effectsEnabled" });
f1.addBinding(group, "padding", { label: "padding", min: 0, max: 0.3, step: 0.01 });

const f2 = pane.addFolder({ title: "group2 (spheres)" });
f2.addBinding(group2, "effectsEnabled", { label: "effectsEnabled" });
f2.addBinding(group2, "padding", { label: "padding", min: 0, max: 0.3, step: 0.01 });

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

  // Spheres orbit around the group2 center at different speeds and radii
  sphereA.position.set(Math.cos(t * 1.1) * 0.55, Math.sin(t * 0.7) * 0.3, Math.sin(t * 1.1) * 0.55);
  sphereB.position.set(Math.cos(t * 0.8 + Math.PI) * 0.7, Math.sin(t * 1.3 + 1) * 0.4, Math.sin(t * 0.8 + Math.PI) * 0.7);

  controls.update();
  Group.preRenderEffects(renderer, scene, camera);
  renderer.render(scene, camera);
});
