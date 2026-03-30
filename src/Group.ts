import {
  Group as ThreeGroup,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  Color,
  Vector3,
} from "three/webgpu";

// 1×1 plane — scale drives the size each frame
const _geo = new PlaneGeometry(1, 1);

// Module-level temporaries to avoid per-frame allocations
const _v = new Vector3();
const _wBL = new Vector3();
const _wBR = new Vector3();
const _wTL = new Vector3();
const _wCenter = new Vector3();

export class Group extends ThreeGroup {
  /** Extra space around the projected bounding box, in NDC units (0 = tight fit). */
  padding = 0;

  private readonly _plane: Mesh;

  constructor() {
    super();

    this._plane = new Mesh(
      _geo,
      new MeshBasicNodeMaterial({ color: new Color(0xff2020), side: 2, depthWrite: false }),
    );
    this._plane.renderOrder = -1;

    this._plane.onBeforeRender = (_renderer, _scene, camera) => {
      // Billboard — copy camera orientation so the plane always faces it
      this._plane.quaternion.copy(camera.quaternion);

      // Project every actual vertex of every sibling mesh directly to NDC.
      // This avoids the double-approximation of first computing a world AABB
      // and then projecting its corners (which adds slack for rotated objects).
      let nMinX = Infinity, nMaxX = -Infinity;
      let nMinY = Infinity, nMaxY = -Infinity;
      let wMinX = Infinity, wMaxX = -Infinity;
      let wMinY = Infinity, wMaxY = -Infinity;
      let wMinZ = Infinity, wMaxZ = -Infinity;
      let hasVerts = false;

      for (const child of this.children) {
        if (child === this._plane) continue;
        child.traverse((obj) => {
          if (!(obj instanceof Mesh)) return;
          const pos = (obj as Mesh).geometry?.attributes?.position;
          if (!pos) return;
          obj.updateWorldMatrix(true, false);
          for (let i = 0, l = pos.count; i < l; i++) {
            _v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
            if (_v.x < wMinX) wMinX = _v.x;
            if (_v.x > wMaxX) wMaxX = _v.x;
            if (_v.y < wMinY) wMinY = _v.y;
            if (_v.y > wMaxY) wMaxY = _v.y;
            if (_v.z < wMinZ) wMinZ = _v.z;
            if (_v.z > wMaxZ) wMaxZ = _v.z;
            _v.project(camera);
            if (_v.x < nMinX) nMinX = _v.x;
            if (_v.x > nMaxX) nMaxX = _v.x;
            if (_v.y < nMinY) nMinY = _v.y;
            if (_v.y > nMaxY) nMaxY = _v.y;
            hasVerts = true;
          }
        });
      }

      if (!hasVerts) return;

      nMinX -= this.padding;
      nMaxX += this.padding;
      nMinY -= this.padding;
      nMaxY += this.padding;

      // NDC z from the world-space content center
      _v.set(
        (wMinX + wMaxX) * 0.5,
        (wMinY + wMaxY) * 0.5,
        (wMinZ + wMaxZ) * 0.5,
      ).project(camera);
      const ndcZ = _v.z;

      // Unproject the 4 NDC bbox corners back to world space at that depth
      _wBL.set(nMinX, nMinY, ndcZ).unproject(camera);
      _wBR.set(nMaxX, nMinY, ndcZ).unproject(camera);
      _wTL.set(nMinX, nMaxY, ndcZ).unproject(camera);
      _wCenter
        .set((nMinX + nMaxX) * 0.5, (nMinY + nMaxY) * 0.5, ndcZ)
        .unproject(camera);

      // Convert to group-local space (accounts for group position/rotation/scale)
      this._plane.position.copy(this.worldToLocal(_wCenter));
      this.worldToLocal(_wBL);
      this.worldToLocal(_wBR);
      this.worldToLocal(_wTL);

      // Edge lengths in local space give the correct plane scale
      this._plane.scale.set(_wBL.distanceTo(_wBR), _wBL.distanceTo(_wTL), 1);
    };

    this.add(this._plane);
  }
}
