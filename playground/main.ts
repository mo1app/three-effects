import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
group.position.y = 0.5;
group.add(cube);
scene.add(group);

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
  controls.update();
  renderer.render(scene, camera);
});
